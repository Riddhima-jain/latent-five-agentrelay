import type { AgentPermission } from "./capability.js";

export type TaskStatus =
  | "blocked"
  | "ready"
  | "running"
  | "approval_required"
  | "completed"
  | "failed"
  | "skipped"
  | "unassigned";

export interface AgentTask {
  id: string;
  sessionId: string;
  title: string;
  requiredCapability: string;
  requiredPermissions: AgentPermission[];
  dependsOn: string[];
  status: TaskStatus;
  assignedAgentId?: string;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
}

/** Untrusted structured output after validation; it never includes policy metadata. */
export interface AgentExecutionResult {
  summary: string;
  evidence: AgentEvidence[];
  proposedActions: ProposedActionInput[];
}

export interface AgentEvidence {
  claim: string;
  sourceRefs: string[];
}

export interface ProposedActionInput {
  type: string;
  target: string;
  payload: unknown;
  rationale?: string;
}
