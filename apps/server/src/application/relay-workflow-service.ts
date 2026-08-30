import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ApprovedAction, ProposedAction } from "../domain/action.js";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { ExternalActionExecutor } from "../domain/ports.js";
import type { SharedSession } from "../domain/session.js";
import type { AgentTask } from "../domain/task.js";
import type { TraceEvent, TraceEventType } from "../domain/trace.js";
import { HttpError } from "../errors.js";
import type { AgentRunner } from "../types.js";
import { payloadHashFor } from "./approval-service.js";
import { decideAutomation } from "./automation-decision-service.js";
import { CodexAgentAdapter } from "./codex-agent-adapter.js";
import { Coordinator } from "./coordinator.js";
import { idempotencyKeyFor } from "./email-executor.js";
import { RecordingAgentExecutor, type ControlledScenario } from "./recording-agent-executor.js";
import type { CreateRelaySessionInput, RelayApprovalView, RelaySessionReader, RelaySessionView, RelayTaskStatus, RelayTraceView } from "./relay-session-service.js";
import { RelayJsonStore } from "./relay-store.js";
import type { AccessGrantService } from "./access-grant-service.js";

const defaultGoal = "Analyze the controlled sales-recovery evidence, recommend a strategy, and draft safe customer outreach.";

export class RelayWorkflowService implements RelaySessionReader {
  private readonly adapter: CodexAgentAdapter;
  private readonly active = new Map<string, Promise<void>>();
  private readonly decisions = new Set<string>();

  constructor(
    private readonly store: RelayJsonStore,
    runner: AgentRunner,
    private readonly actionExecutor: ExternalActionExecutor,
    private readonly workspaceRootPath: string,
    _fixtureRoot: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => randomUUID(),
    private readonly runtimeAvailable: () => Promise<boolean> = () => Promise.resolve(true),
    private readonly accessGrantService?: AccessGrantService,
    private readonly resourceGatewayBaseUrl?: string,
  ) {
    this.adapter = new CodexAgentAdapter(runner, SALES_RECOVERY_AGENTS.map((agent) => ({
      agentId: agent.agentId,
      workspacePath: path.join(this.workspaceRootPath, ".agentrelay", agent.agentId),
    })));
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    const interrupted = (await this.store.listSessions()).filter((session) => session.status === "running");
    await Promise.all(interrupted.map(async (session) => {
      const updated = { ...session, status: "failed" as const, updatedAt: this.now() };
      await this.store.save(updated);
      await this.trace(session, "session.failed", { metadata: { reason: "Server restarted during workflow execution" } });
    }));
  }

  async createSession(input: CreateRelaySessionInput = {}): Promise<RelaySessionView> {
    if (!await this.runtimeAvailable()) throw new HttpError(503, "Agent Runtime is not configured or unavailable");
    if (this.active.size > 0) throw new HttpError(409, "A Relay workflow is already running");
    const id = `STR-${this.createId().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    if (await this.store.get(id)) throw new HttpError(409, "Generated Relay session identifier already exists");
    const timestamp = this.now();
    const session: SharedSession = {
      id, goal: input.goal?.trim() || defaultGoal, traceId: `trace-${id}`,
      participantAgentIds: SALES_RECOVERY_AGENTS.map((agent) => agent.agentId),
      status: "created", createdAt: timestamp, updatedAt: timestamp,
    };
    await Promise.all(SALES_RECOVERY_AGENTS.map((agent) => mkdir(path.join(this.workspaceRootPath, ".agentrelay", agent.agentId), { recursive: true })));
    const scenario = input.scenario ?? "normal";
    const executor = new RecordingAgentExecutor(this.adapter, this.store, scenario, this.now);
    const coordinator = new Coordinator(
      SALES_RECOVERY_TASKS, SALES_RECOVERY_AGENTS,
      {
        agentExecutor: executor,
        sessionStore: this.store,
        taskStore: this.store.taskStore,
        evidenceStore: this.store.evidenceStore,
        traceSink: this.store,
        ...(this.accessGrantService ? { accessGrantService: this.accessGrantService } : {}),
      },
      this.now, undefined, resourcesForTask, undefined, this.resourceGatewayBaseUrl,
    );
    const started = await coordinator.start(session);
    if (!started.started) throw new Error(`Invalid sales recovery workflow: ${started.errors.map((error) => error.message).join("; ")}`);
    const execution = this.runCoordinator(session.id, coordinator, scenario).finally(() => this.active.delete(session.id));
    this.active.set(session.id, execution);
    return this.getSession(session.id);
  }

  async listSessions(): Promise<RelaySessionView[]> {
    const sessions = await this.store.listSessions();
    const views = await Promise.all(sessions.map((session) => this.project(session)));
    return views.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getSession(id: string): Promise<RelaySessionView> {
    const session = await this.store.get(id);
    if (!session) throw new HttpError(404, `Relay session not found: ${id}`);
    return this.project(session);
  }

  async decideApproval(approvalId: string, decision: "approve" | "deny"): Promise<RelaySessionView> {
    if (this.decisions.has(approvalId)) throw new HttpError(409, "Approval decision is already in progress");
    this.decisions.add(approvalId);
    try {
      const approval = await this.store.getApproval(approvalId);
      if (!approval) throw new HttpError(404, `Relay approval not found: ${approvalId}`);
      if (approval.status !== "pending") throw new HttpError(409, `Action approval is already ${approval.status}`);
      const session = await this.requireSession(approval.sessionId);
      const action = await this.store.getAction(approval.actionId);
      if (!action) throw new HttpError(409, "Approved action no longer exists");
      if (approval.payloadHash !== payloadHashFor(action)) {
        const invalidated = { ...approval, status: "invalidated" as const, invalidatedAt: this.now() };
        await this.store.saveApproval(invalidated);
        await this.trace(session, "approval.invalidated", { taskId: action.taskId, agentId: action.producerAgentId });
        throw new HttpError(409, "Action contents changed after approval was requested");
      }
      if (decision === "deny") {
        await this.store.saveApproval({ ...approval, status: "denied", deniedAt: this.now() });
        await this.store.save({ ...session, status: "degraded", updatedAt: this.now() });
        await this.trace(session, "approval.denied", { taskId: action.taskId, agentId: action.producerAgentId });
        return this.getSession(session.id);
      }
      await this.store.saveApproval({ ...approval, status: "approved", approvedAt: this.now() });
      await this.trace(session, "approval.granted", { taskId: action.taskId, agentId: action.producerAgentId });
      const approved: ApprovedAction = { ...action, payloadHash: approval.payloadHash, idempotencyKey: idempotencyKeyFor(action.id, approval.payloadHash) };
      await this.trace(session, "action.execution_started", { taskId: action.taskId, agentId: action.producerAgentId });
      try {
        const result = await this.actionExecutor.execute(approved);
        if (result.status !== "succeeded") throw new Error(result.error ?? "Protected action failed");
        await this.store.save({ ...session, status: "completed", updatedAt: this.now() });
        await this.trace(session, "action.executed", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { externalReference: result.externalReference } });
      } catch (error) {
        await this.store.save({ ...session, status: "degraded", updatedAt: this.now() });
        await this.trace(session, "action.failed", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { reason: error instanceof Error ? error.message : String(error) } });
        throw new HttpError(502, "Protected email delivery failed; approval remains recorded");
      }
      return this.getSession(session.id);
    } finally {
      this.decisions.delete(approvalId);
    }
  }

  private async runCoordinator(sessionId: string, coordinator: Coordinator, scenario: ControlledScenario): Promise<void> {
    try {
      for (let tick = 0; tick < 12; tick += 1) {
        const snapshot = coordinator.getSnapshot();
        if (snapshot.readyTaskIds.length === 0) break;
        await coordinator.tick();
      }
      await this.applyPolicy(sessionId, scenario);
    } catch (error) {
      const session = await this.requireSession(sessionId);
      await this.store.save({ ...session, status: "failed", updatedAt: this.now() });
      await this.trace(session, "session.failed", { metadata: { reason: error instanceof Error ? error.message : String(error) } });
    }
  }

  private async applyPolicy(sessionId: string, _scenario: ControlledScenario): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status === "failed") return;
    const actions = await this.store.listActions(sessionId);
    if (actions.length === 0) return;
    const evidence = await this.store.listEvidence(sessionId);
    const action = actions[0]!;
    const agent = SALES_RECOVERY_AGENTS.find((candidate) => candidate.agentId === action.producerAgentId);
    const policy = decideAutomation(action, evidence, { agentId: action.producerAgentId, registered: agent !== undefined, permissions: agent?.permissions ?? [] });
    if (policy.decision === "REQUIRE_APPROVAL") {
      const approval = { id: `approval-${action.id}`, actionId: action.id, payloadHash: payloadHashFor(action), sessionId, status: "pending" as const, createdAt: this.now() };
      await this.store.saveApproval(approval);
      await this.store.save({ ...session, status: "awaiting_approval", updatedAt: this.now() });
      await this.trace(session, "policy.approval_required", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { reasons: policy.reasons } });
      await this.trace(session, "approval.requested", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { approvalId: approval.id } });
    } else if (policy.decision === "DENY") {
      await this.store.save({ ...session, status: "degraded", updatedAt: this.now() });
      await this.trace(session, "policy.denied", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { reasons: policy.reasons } });
    } else {
      await this.store.save({ ...session, status: "recommend_only", updatedAt: this.now() });
      await this.trace(session, "policy.recommend_only", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { reasons: policy.reasons } });
    }
  }

  private async project(session: SharedSession): Promise<RelaySessionView> {
    const [tasks, evidence, traces, actions, results, receipts] = await Promise.all([
      this.store.listBySession(session.id), this.store.listEvidence(session.id), this.store.listTrace(session.id),
      this.store.listActions(session.id), this.store.listTaskResults(session.id), this.store.listReceipts(session.id),
    ]);
    const action = actions[0] ?? null;
    const approvalRecord = action ? await this.store.getApproval(`approval-${action.id}`) : null;
    const approval: RelayApprovalView | null = action && approvalRecord && action.type === "SEND_EMAIL" ? {
      id: approvalRecord.id, actionId: action.id, actionHash: approvalRecord.payloadHash, status: approvalRecord.status,
      decision: "REQUIRE_APPROVAL", actionType: "SEND_EMAIL",
      recipient: String((action.payload as { recipient?: unknown }).recipient ?? action.target),
      subject: String((action.payload as { subject?: unknown }).subject ?? "Customer outreach"),
      body: String((action.payload as { body?: unknown }).body ?? ""),
      rationale: action.rationale ?? "External action requires approval.",
    } : null;
    return {
      id: session.id, traceId: session.traceId, title: "Workflow Overview", goal: session.goal,
      status: session.status === "completed" && action && !approvalRecord ? "running" : projectSessionStatus(session.status), startedAt: session.createdAt,
      tasks: tasks.map((task) => {
        const agent = SALES_RECOVERY_AGENTS.find((candidate) => candidate.agentId === task.assignedAgentId);
        const result = results.find((candidate) => candidate.taskId === task.id);
        const started = traces.find((event) => event.taskId === task.id && event.type === "task.started");
        const completed = traces.find((event) => event.taskId === task.id && event.type === "task.completed");
        const durationMs = started && completed ? Date.parse(completed.timestamp) - Date.parse(started.timestamp) : undefined;
        const approvalStatus = task.id === "outreach" && approvalRecord?.status === "pending" ? "approval_required" : task.id === "outreach" && approvalRecord?.status === "denied" ? "denied" : undefined;
        return { id: task.id, title: task.title, agentId: task.assignedAgentId ?? "unassigned", agentName: agent?.name ?? "Unassigned", status: approvalStatus ?? projectTaskStatus(task), dependsOn: [...task.dependsOn], ...(result?.summary ? { summary: result.summary } : {}), ...(durationMs !== undefined ? { durationMs } : {}), ...(started ? { startedAt: started.timestamp } : {}), ...(completed ? { completedAt: completed.timestamp } : {}) };
      }),
      approval,
      trace: traces.map(projectTrace),
      evidence: evidence.map((record) => ({ id: record.id, taskId: record.taskId, claim: record.claim, sourceRefs: [...record.sourceRefs], status: record.status, createdAt: record.createdAt })),
      receipts: receipts.map((receipt) => ({ actionId: receipt.actionId, provider: receipt.provider, externalReference: receipt.externalReference, acceptedAt: receipt.acceptedAt })),
    };
  }

  private async requireSession(id: string): Promise<SharedSession> {
    const session = await this.store.get(id);
    if (!session) throw new HttpError(404, `Relay session not found: ${id}`);
    return session;
  }

  private async trace(session: SharedSession, type: TraceEventType, details: Pick<Partial<TraceEvent>, "taskId" | "agentId" | "metadata"> = {}): Promise<void> {
    const timestamp = this.now();
    await this.store.append({ id: `${session.id}:${type}:${randomUUID()}`, traceId: session.traceId, sessionId: session.id, type, timestamp, ...details });
  }

}

function resourcesForTask(task: AgentTask): readonly string[] {
  if (task.id === "research") return ["market/market-report.json"];
  if (task.id === "finance") return ["finance/finance-report.csv"];
  if (task.id === "outreach") return ["customer/customer-list.json"];
  return [];
}

function projectTaskStatus(task: AgentTask): RelayTaskStatus {
  if (task.status === "blocked") return "waiting";
  if (task.status === "unassigned" || task.status === "skipped") return "failed";
  return task.status;
}

function projectSessionStatus(status: SharedSession["status"]): RelaySessionView["status"] {
  if (status === "created" || status === "recommend_only" || status === "cancelled") return status === "created" ? "running" : "degraded";
  return status;
}

function projectTrace(event: TraceEvent): RelayTraceView {
  const danger = event.type.includes("failed") || event.type.includes("denied") || event.type.includes("invalidated");
  const warning = event.type.includes("approval") || event.type.includes("retry") || event.type.includes("proposed");
  const success = event.type.includes("completed") || event.type.includes("executed") || event.type.includes("accepted");
  return { id: event.id, type: event.type, timestamp: event.timestamp, summary: traceSummary(event), tone: danger ? "danger" : warning ? "warning" : success ? "success" : "neutral", ...(event.taskId ? { taskId: event.taskId } : {}), ...(event.agentId ? { agentId: event.agentId } : {}) };
}

function traceSummary(event: TraceEvent): string {
  const reason = event.metadata?.reason;
  if (typeof reason === "string") return reason;
  return event.type.replaceAll(".", " ");
}
