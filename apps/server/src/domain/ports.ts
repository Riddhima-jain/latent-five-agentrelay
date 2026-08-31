import type { ApprovedAction, ActionResult } from "./action.js";
import type { EvidenceRecord } from "./evidence.js";
import type { SharedSession } from "./session.js";
import type { AgentExecutionResult, AgentTask } from "./task.js";
import type { TraceEvent } from "./trace.js";
import type { AccessGrant } from "./tool-access.js";
import type { AgentManifest } from "./capability.js";

export interface ExecutionContext {
  sessionId: string;
  taskId: string;
  goal: string;
  constraints: string[];
  allowedResources: string[];
  dependencyEvidence: EvidenceRecord[];
  accessGrantId?: string;
}

export interface AccessGrantIssuer { issueGrant(input: { sessionId: string; taskId: string; agent: AgentManifest }): Promise<AccessGrant>; revokeGrant?(grantId: string): Promise<void> }
export interface ProtectedResourceReader { readResource(input: { grantId: string; resource: string }): Promise<{ content: string; contentType: string; sourceRef: string }> }

export interface AgentExecutor {
  execute(agentId: string, task: AgentTask, context: ExecutionContext): Promise<AgentExecutionResult>;
}

export interface SessionStore {
  get(sessionId: string): Promise<SharedSession | null>;
  save(session: SharedSession): Promise<void>;
}

export interface TaskStore {
  get(taskId: string): Promise<AgentTask | null>;
  listBySession(sessionId: string): Promise<AgentTask[]>;
  save(task: AgentTask): Promise<void>;
}

export interface EvidenceStore {
  save(record: EvidenceRecord): Promise<void>;
  listForTasks(taskIds: string[]): Promise<EvidenceRecord[]>;
}

/** Trusted record of sourceRefs returned by successful, policy-authorized reads. */
export interface EvidenceSourceAuthorizer {
  listAuthorizedSourceRefs(input: { sessionId: string; taskId: string; agentId: string }): Promise<string[]>;
}

export interface TraceSink {
  append(event: TraceEvent): Promise<void>;
}

export interface ExternalActionExecutor {
  execute(action: ApprovedAction): Promise<ActionResult>;
}
