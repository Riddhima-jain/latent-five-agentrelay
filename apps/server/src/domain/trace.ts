export type TraceEventType =
  | "session.created"
  | "task.created"
  | "task.ready"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "agent.selected"
  | "agent.invoked"
  | "grant.issued"
  | "tool.access.requested"
  | "tool.access.allowed"
  | "tool.access.denied"
  | "agent.result_invalid"
  | "grant.issued"
  | "tool.access.requested"
  | "tool.access.allowed"
  | "tool.access.denied"
  | "evidence.created"
  | "evidence.accepted"
  | "evidence.rejected"
  | "action.proposed"
  | "policy.auto_execute"
  | "policy.approval_required"
  | "policy.recommend_only"
  | "policy.denied"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  | "approval.invalidated"
  | "action.execution_started"
  | "action.executed"
  | "action.failed"
  | "retry.scheduled"
  | "session.degraded"
  | "session.completed"
  | "session.failed";

/** Metadata must be redacted by the caller before this port persists it. */
export interface TraceEvent {
  id: string;
  traceId: string;
  sessionId: string;
  runId?: string;
  taskId?: string;
  agentId?: string;
  type: TraceEventType;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
