import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ApprovedAction, ProposedAction } from "../domain/action.js";
import type { AgentManifest } from "../domain/capability.js";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { ExternalActionExecutor } from "../domain/ports.js";
import type { SendEmailPayload } from "../domain/protected-action.js";
import type { SharedSession } from "../domain/session.js";
import type { AgentTask } from "../domain/task.js";
import type { TraceEvent, TraceEventType } from "../domain/trace.js";
import { HttpError } from "../errors.js";
import type { AgentRunner } from "../types.js";
import { InMemoryExecutionStore } from "../adapters/in-memory-execution-store.js";
import { payloadHashFor } from "./approval-service.js";
import { decideAutomation } from "./automation-decision-service.js";
import { CodexAgentAdapter } from "./codex-agent-adapter.js";
import { AccessGrantService } from "./access-grant-service.js";
import { FixtureResourceStore } from "./fixture-resource-store.js";
import { ResourceGatewayService } from "./resource-gateway-service.js";
import { ToolPolicyService } from "./tool-policy-service.js";
import { Coordinator } from "./coordinator.js";
import type { ExecutionStore } from "./execution-ports.js";
import { ExecutionService } from "./execution-service.js";
import { RecoveryService } from "./recovery-service.js";
import { RelayApprovalVerifier } from "./relay-approval-verifier.js";
import { RecordingAgentExecutor, type ControlledScenario } from "./recording-agent-executor.js";
import type { CreateRelaySessionInput, RelayAgentManifestView, RelayApprovalView, RelaySessionReader, RelaySessionView, RelayTaskStatus, RelayTraceView } from "./relay-session-service.js";
import { RelayJsonStore } from "./relay-store.js";

const defaultGoal = "Analyze the controlled sales-recovery evidence, recommend a strategy, and draft safe customer outreach.";

export class RelayWorkflowService implements RelaySessionReader {
  private readonly adapter: CodexAgentAdapter;
  private readonly active = new Map<string, Promise<void>>();
  private readonly decisions = new Set<string>();
  private readonly approvalVerifier: RelayApprovalVerifier;
  private readonly recovery = new RecoveryService();
  private readonly executionStore: ExecutionStore;
  private readonly baseSecrets: readonly string[];
  private readonly grants = new AccessGrantService();
  readonly resourceGateway: ResourceGatewayService;

  constructor(
    private readonly store: RelayJsonStore,
    runner: AgentRunner,
    private readonly actionExecutor: ExternalActionExecutor,
    private readonly workspaceRootPath: string,
    fixtureRoot: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => randomUUID(),
    private readonly runtimeAvailable: () => Promise<boolean> = () => Promise.resolve(true),
    private agents: readonly AgentManifest[] = SALES_RECOVERY_AGENTS,
    gatewayBaseUrl = "http://127.0.0.1:3000/api/middleware/resources",
    resourceHelperCommand = "agentrelay-resource",
    private readonly agentProvider?: () => Promise<AgentManifest[]>,
    executionStore: ExecutionStore = new InMemoryExecutionStore(),
    secrets: readonly string[] = [],
  ) {
    this.approvalVerifier = new RelayApprovalVerifier(store);
    this.executionStore = executionStore;
    this.baseSecrets = secrets;
    this.resourceGateway = new ResourceGatewayService(this.grants, new ToolPolicyService(), new FixtureResourceStore(path.join(fixtureRoot, "protected")), this.store, async (sessionId) => (await this.requireSession(sessionId)).traceId, this.now);
    this.adapter = new CodexAgentAdapter(runner, this.agents.map((agent) => ({
      agentId: agent.agentId,
      workspacePath: path.join(this.workspaceRootPath, agent.agentId),
    })), this.resourceGateway, gatewayBaseUrl, resourceHelperCommand);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    const sessions = await this.store.listSessions();
    const interrupted = sessions.filter((session) => session.status === "running");
    await Promise.all(interrupted.map(async (session) => {
      await this.trace(session, "session.failed", { metadata: { reason: "Server restarted during workflow execution" } });
      await this.store.save({ ...session, status: "failed" as const, updatedAt: this.now() });
    }));
    // A process that died mid-`decideApproval` leaves the session at
    // awaiting_approval with an already-approved record. Reconcile from the
    // receipt store so the session is never wedged: a receipt means the email
    // was delivered (completed), its absence means it was not (failed).
    const awaiting = sessions.filter((session) => session.status === "awaiting_approval");
    await Promise.all(awaiting.map(async (session) => {
      const action = (await this.store.listActions(session.id))[0];
      if (!action) return;
      const approval = await this.store.getApproval(`approval-${action.id}`);
      if (approval?.status !== "approved") return;
      const delivered = (await this.store.listReceipts(session.id)).length > 0;
      const status = delivered ? "completed" as const : "failed" as const;
      await this.trace(session, delivered ? "session.completed" : "session.failed", { metadata: { reason: "Reconciled after restart from the execution ledger" } });
      await this.store.save({ ...session, status, updatedAt: this.now() });
    }));
  }

  async createSession(input: CreateRelaySessionInput = {}): Promise<RelaySessionView> {
    if (!await this.runtimeAvailable()) throw new HttpError(503, "Agent Runtime is not configured or unavailable");
    if (this.active.size > 0) throw new HttpError(409, "A Relay workflow is already running");
    if (this.agentProvider) this.agents = await this.agentProvider();
    for (const definition of SALES_RECOVERY_TASKS) {
      const registered = this.agents.find((agent) => agent.capabilities.includes(definition.requiredCapability));
      if (!registered) throw new HttpError(409, `AGENT_NOT_REGISTERED: ${definition.requiredCapability}`);
      if (!registered.runnable) throw new HttpError(409, `AGENT_NOT_RUNNABLE: ${registered.agentId}`);
    }
    const id = `STR-${this.createId().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    if (await this.store.get(id)) throw new HttpError(409, "Generated Relay session identifier already exists");
    const timestamp = this.now();
    const session: SharedSession = {
      id, goal: input.goal?.trim() || defaultGoal, traceId: `trace-${id}`,
      participantAgentIds: this.agents.map((agent) => agent.agentId),
      status: "created", createdAt: timestamp, updatedAt: timestamp,
    };
    await Promise.all(this.agents.map((agent) => mkdir(path.join(this.workspaceRootPath, agent.agentId), { recursive: true })));
    const scenario = input.scenario ?? "normal";
    const executor = new RecordingAgentExecutor(this.adapter, this.store, scenario, this.now);
    const coordinator = new Coordinator(
      SALES_RECOVERY_TASKS, this.agents,
      { agentExecutor: executor, sessionStore: this.store, taskStore: this.store.taskStore, evidenceStore: this.store.evidenceStore, traceSink: this.store, accessGrantIssuer: this.grants },
      this.now, undefined, resourcesForTask,
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

  async listAgentManifests(): Promise<RelayAgentManifestView[]> {
    if (this.agentProvider) this.agents = await this.agentProvider();
    return this.agents.map(projectAgentManifest);
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
      if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
        throw new HttpError(409, `Relay session is already ${session.status}`);
      }
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
        await this.trace(session, "approval.denied", { taskId: action.taskId, agentId: action.producerAgentId });
        await this.store.save({ ...session, status: "degraded", updatedAt: this.now() });
        return this.getSession(session.id);
      }
      await this.store.saveApproval({ ...approval, status: "approved", approvedAt: this.now() });
      await this.trace(session, "approval.granted", { taskId: action.taskId, agentId: action.producerAgentId });
      const payload = action.payload as Partial<SendEmailPayload>;
      const approved: ApprovedAction = {
        ...action,
        payloadHash: approval.payloadHash,
        idempotencyKey: `${session.id}|${action.id}|${approval.payloadHash}`,
      };
      const payloadSecrets = [payload.recipient, payload.subject].filter((value): value is string => typeof value === "string" && value.length > 0);
      // ExecutionService owns approval enforcement, the atomic idempotency ledger,
      // timeout/retry, and the redacted action.* / retry.* trace events (KTD10, KTD11).
      const execution = new ExecutionService({
        verifier: this.approvalVerifier,
        store: this.executionStore,
        executor: this.actionExecutor,
        recovery: this.recovery,
        sink: this.store,
        traceId: session.traceId,
        secrets: [...this.baseSecrets, ...payloadSecrets],
        maxAttempts: 3,
        timeoutMs: 10_000,
      });
      try {
        const outcome = await execution.run(approved, "REQUIRE_APPROVAL");
        if (outcome.terminal) {
          await this.trace(session, "session.failed", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { reason: outcome.reason ?? "Protected action failed" } });
          await this.store.save({ ...session, status: "failed", updatedAt: this.now() });
          throw new HttpError(502, "Protected action failed; approval remains recorded");
        }
        if (outcome.result.status !== "succeeded") {
          // Another in-flight execution holds the idempotency claim; the caller can retry.
          throw new HttpError(409, "Protected action is already in progress");
        }
        await this.store.save({ ...session, status: "completed", updatedAt: this.now() });
        return this.getSession(session.id);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        // An unexpected failure after the approval was granted must still land a
        // terminal session status, or the session wedges at awaiting_approval.
        await this.trace(session, "session.failed", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { reason: error instanceof Error ? error.message : String(error) } });
        await this.store.save({ ...session, status: "failed", updatedAt: this.now() });
        throw new HttpError(502, "Protected action execution failed unexpectedly");
      }
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
      await this.trace(session, "session.failed", { metadata: { reason: error instanceof Error ? error.message : String(error) } });
      await this.store.save({ ...session, status: "failed", updatedAt: this.now() });
    }
  }

  private async applyPolicy(sessionId: string, _scenario: ControlledScenario): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (session.status === "failed") return;
    const actions = await this.store.listActions(sessionId);
    if (actions.length === 0) return;
    const evidence = await this.store.listEvidence(sessionId);
    let finalStatus: SharedSession["status"] = "completed";
    for (const action of actions) {
      const agent = this.agents.find((candidate) => candidate.agentId === action.producerAgentId);
      const policy = decideAutomation(action, evidence, { agentId: action.producerAgentId, registered: agent !== undefined, permissions: agent?.permissions ?? [] });
      const metadata = { actionId: action.id, actionType: action.type, reasons: policy.reasons };
      // Persist the approval record and trace events before the status a poller
      // keys on; the session status is saved once after the loop.
      if (policy.decision === "REQUIRE_APPROVAL") {
        const approval = { id: `approval-${action.id}`, actionId: action.id, payloadHash: payloadHashFor(action), sessionId, status: "pending" as const, createdAt: this.now() };
        await this.store.saveApproval(approval);
        finalStatus = "awaiting_approval";
        await this.trace(session, "policy.approval_required", { taskId: action.taskId, agentId: action.producerAgentId, metadata });
        await this.trace(session, "approval.requested", { taskId: action.taskId, agentId: action.producerAgentId, metadata: { approvalId: approval.id } });
      } else if (policy.decision === "DENY") {
        if (finalStatus !== "awaiting_approval") finalStatus = "degraded";
        await this.trace(session, "policy.denied", { taskId: action.taskId, agentId: action.producerAgentId, metadata });
      } else if (policy.decision === "RECOMMEND_ONLY") {
        if (finalStatus === "completed") finalStatus = "recommend_only";
        await this.trace(session, "policy.recommend_only", { taskId: action.taskId, agentId: action.producerAgentId, metadata });
      } else {
        await this.trace(session, "policy.auto_execute", { taskId: action.taskId, agentId: action.producerAgentId, metadata });
      }
    }
    await this.store.save({ ...session, status: finalStatus, updatedAt: this.now() });
  }

  private async project(session: SharedSession): Promise<RelaySessionView> {
    const [tasks, evidence, traces, actions, results, receipts] = await Promise.all([
      this.store.listBySession(session.id), this.store.listEvidence(session.id), this.store.listTrace(session.id),
      this.store.listActions(session.id), this.store.listTaskResults(session.id), this.store.listReceipts(session.id),
    ]);
    const approvalPairs = await Promise.all(actions.map(async (candidate) => ({ action: candidate, approval: await this.store.getApproval(`approval-${candidate.id}`) })));
    const approvedPair = approvalPairs.find((pair) => pair.approval) ?? null;
    const action = approvedPair?.action ?? actions[0] ?? null;
    const approvalRecord = approvedPair?.approval ?? null;
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
        const agent = this.agents.find((candidate) => candidate.agentId === task.assignedAgentId);
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
      agentManifests: this.agents.map(projectAgentManifest),
      resourceAccessEvents: traces.filter((event) => event.type === "tool.access.allowed" || event.type === "tool.access.denied").map((event) => ({ id: event.id, timestamp: event.timestamp, agentId: event.agentId ?? "unknown", agentName: this.agents.find((agent) => agent.agentId === event.agentId)?.name ?? "Unknown Agent", taskId: event.taskId ?? "unknown", tool: "resource.read" as const, resource: String(event.metadata?.resource ?? "unknown"), operation: "read" as const, decision: event.type === "tool.access.allowed" ? "ALLOW" as const : "DENY" as const, reason: String(event.metadata?.reason ?? "INVALID_GRANT") })),
      recommendations: traces.filter((event) => event.type === "policy.recommend_only").flatMap((event) => { const recommendationAction = actions.find((candidate) => candidate.id === event.metadata?.actionId); return recommendationAction ? [{ id: `recommendation-${recommendationAction.id}`, taskId: recommendationAction.taskId, actionType: recommendationAction.type, summary: recommendationAction.rationale ?? `Review proposed ${recommendationAction.type}`, decision: "RECOMMEND_ONLY" as const, reasons: Array.isArray(event.metadata?.reasons) ? event.metadata.reasons.map(String) : [], supportingEvidenceIds: evidence.filter((record) => record.status === "accepted").map((record) => record.id) }] : []; }),
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

function projectAgentManifest(agent: AgentManifest): RelayAgentManifestView {
  return { agentId: agent.agentId, name: agent.name, capabilities: [...agent.capabilities], runnable: agent.runnable, allowedTools: [...(agent.toolPolicy?.allowedTools ?? [])], resourceScopes: (agent.toolPolicy?.resourceScopes ?? []).map((scope) => scope.pattern) };
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
