import type { AutomationDecision, ProposedAction } from "../domain/action.js";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import { HttpError } from "../errors.js";
import { InMemoryApprovalService } from "./approval-service.js";
import { decideAutomation } from "./automation-decision-service.js";

export type RelayTaskStatus = "waiting" | "ready" | "running" | "completed" | "failed" | "approval_required" | "denied";

export interface RelayTaskView {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  status: RelayTaskStatus;
  dependsOn: string[];
  summary?: string;
  durationMs?: number;
}

export interface RelayApprovalView {
  id: string;
  actionId: string;
  actionHash: string;
  status: "pending" | "approved" | "denied" | "invalidated";
  decision: AutomationDecision;
  actionType: "SEND_EMAIL";
  recipient: string;
  subject: string;
  body: string;
  rationale: string;
}

export interface RelayTraceView {
  id: string;
  type: string;
  timestamp: string;
  taskId?: string;
  agentId?: string;
  summary: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface RelaySessionView {
  id: string;
  traceId: string;
  title: string;
  status: "running" | "awaiting_approval" | "completed" | "failed" | "degraded";
  startedAt: string;
  tasks: RelayTaskView[];
  approval: RelayApprovalView | null;
  trace: RelayTraceView[];
}

export interface RelaySessionReader {
  getSession(id: string): RelaySessionView;
  decideApproval(approvalId: string, decision: "approve" | "deny"): RelaySessionView;
}

const SESSION_ID = "demo";
const ACTION_ID = "send-email-demo";

/**
 * HTTP-facing demo aggregate. Policy and approval remain server-owned: callers
 * may choose approve or deny, but cannot supply action contents or risk claims.
 */
export class DemoRelaySessionService implements RelaySessionReader {
  private readonly approvals: InMemoryApprovalService;
  private readonly action: ProposedAction;
  private readonly policyDecision: AutomationDecision;
  private readonly startedAt: string;
  private readonly trace: RelayTraceView[];
  private outcome: "pending" | "approved" | "denied" = "pending";
  private eventSequence = 0;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {
    this.approvals = new InMemoryApprovalService(now);
    this.startedAt = now();
    this.action = {
      id: ACTION_ID,
      sessionId: SESSION_ID,
      taskId: "outreach",
      producerAgentId: "outreach-agent",
      type: "SEND_EMAIL",
      target: "24 external contacts",
      payload: {
        recipient: "24 external contacts",
        subject: "Draft Outreach Emails",
        body: "Create tailored recovery messages using the approved strategy and verified evidence.",
      },
      rationale: "The next action writes outbound emails to external recipients and requires human approval.",
      createdAt: this.startedAt,
    };
    const outreach = SALES_RECOVERY_AGENTS.find((agent) => agent.agentId === "outreach-agent");
    const result = decideAutomation(this.action, [{ status: "accepted" }], {
      agentId: outreach?.agentId ?? "outreach-agent",
      registered: outreach !== undefined,
      permissions: outreach?.permissions ?? [],
    });
    this.policyDecision = result.decision;
    if (result.decision !== "REQUIRE_APPROVAL") {
      throw new Error(`Demo SEND_EMAIL policy must require approval, received ${result.decision}`);
    }
    this.approvals.registerAction(this.action);
    this.trace = this.initialTrace();
  }

  getSession(id: string): RelaySessionView {
    if (id !== SESSION_ID) throw new HttpError(404, `Relay session not found: ${id}`);
    return this.snapshot();
  }

  decideApproval(approvalId: string, decision: "approve" | "deny"): RelaySessionView {
    const current = this.approvals.getApproval(ACTION_ID);
    if (current === undefined || current.id !== approvalId) {
      throw new HttpError(404, `Relay approval not found: ${approvalId}`);
    }
    try {
      if (decision === "approve") {
        this.approvals.approveAction(ACTION_ID);
        const authorization = this.approvals.authorize(this.action);
        if (!authorization.executable) throw new Error(authorization.reason);
        this.outcome = "approved";
        this.appendTrace("approval.granted", "Human approved the payload-bound action", "success");
        this.appendTrace("action.executed", "Protected email action released to the trusted executor", "success");
      } else {
        this.approvals.denyAction(ACTION_ID);
        this.outcome = "denied";
        this.appendTrace("approval.denied", "Human denied the protected action", "danger");
      }
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
    return this.snapshot();
  }

  private snapshot(): RelaySessionView {
    const record = this.approvals.getApproval(ACTION_ID)!;
    const payload = this.action.payload as { recipient: string; subject: string; body: string };
    const taskState: Record<string, RelayTaskStatus> = {
      research: "completed",
      finance: "completed",
      strategy: "completed",
      outreach: this.outcome === "pending" ? "approval_required" : this.outcome === "approved" ? "completed" : "denied",
    };
    const summaries: Record<string, string> = {
      research: "Collected market data, trends, and competitive landscape.",
      finance: "Analyzed financials, KPIs, and growth metrics.",
      strategy: "Synthesized evidence into a targeted recovery strategy.",
      outreach: this.outcome === "approved" ? "Approved email executed by the trusted action service." : this.outcome === "denied" ? "Human reviewer denied the proposed email." : "Email drafted. External write is paused for human approval.",
    };
    return {
      id: SESSION_ID,
      traceId: "trace-sales-recovery-demo",
      title: "Workflow Overview",
      status: this.outcome === "pending" ? "awaiting_approval" : this.outcome === "approved" ? "completed" : "degraded",
      startedAt: this.startedAt,
      tasks: SALES_RECOVERY_TASKS.map((definition, index) => {
        const agent = SALES_RECOVERY_AGENTS.find((candidate) => candidate.capabilities.includes(definition.requiredCapability));
        return {
          id: definition.id,
          title: definition.title,
          agentId: agent?.agentId ?? "unassigned",
          agentName: agent?.name ?? "Unassigned",
          status: taskState[definition.id] ?? "waiting",
          dependsOn: [...definition.dependsOn],
          summary: summaries[definition.id] ?? "Task status is available in the trace.",
          ...(index < 3 ? { durationMs: [360_000, 480_000, 420_000][index]! } : {}),
        };
      }),
      approval: { id: record.id, actionId: record.actionId, actionHash: record.payloadHash, status: record.status, decision: this.policyDecision, actionType: "SEND_EMAIL", recipient: payload.recipient, subject: payload.subject, body: payload.body, rationale: this.action.rationale ?? "External action requires approval." },
      trace: this.trace.map((event) => ({ ...event })),
    };
  }

  private initialTrace(): RelayTraceView[] {
    return [
      this.event("session.created", "Sales recovery session created", "neutral"),
      this.event("task.completed", "Market research evidence accepted", "success", "research", "research-agent"),
      this.event("task.completed", "Financial analysis evidence accepted", "success", "finance", "finance-agent"),
      this.event("task.completed", "Recovery strategy completed", "success", "strategy", "strategy-agent"),
      this.event("action.proposed", "Outreach Agent proposed SEND_EMAIL", "warning", "outreach", "outreach-agent"),
      this.event("policy.approval_required", "External write paused by server policy", "warning", "outreach", "outreach-agent"),
    ];
  }

  private appendTrace(type: string, summary: string, tone: RelayTraceView["tone"]): void {
    this.trace.push(this.event(type, summary, tone, "outreach", "outreach-agent"));
  }

  private event(type: string, summary: string, tone: RelayTraceView["tone"], taskId?: string, agentId?: string): RelayTraceView {
    this.eventSequence += 1;
    return { id: `relay-event-${this.eventSequence}-${type}`, type, timestamp: this.now(), summary, tone, ...(taskId ? { taskId } : {}), ...(agentId ? { agentId } : {}) };
  }
}
