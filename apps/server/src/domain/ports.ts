import type { ApprovedAction, ActionResult } from "./action.js";
import type { EvidenceRecord } from "./evidence.js";
import type { SharedSession } from "./session.js";
import type { AgentExecutionResult, AgentTask } from "./task.js";
import type { TraceEvent } from "./trace.js";
import type { AccessGrant } from "./tool-access.js";

export interface ExecutionContext {
  sessionId: string;
  taskId: string;
  goal: string;
  constraints: string[];
  allowedResources: string[];
  dependencyEvidence: EvidenceRecord[];
  /** Logical protected-resource handles only; no raw paths or grant token are exposed. */
  resourceAccess?: {
    gatewayBaseUrl: string;
    allowedResourceHandles: string[];
  };
  /** Opaque server-issued grant for runtime configuration; never prompt content. */
  accessGrant?: AccessGrant;
}

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

export interface TraceSink {
  append(event: TraceEvent): Promise<void>;
}

export interface ExternalActionExecutor {
  execute(action: ApprovedAction): Promise<ActionResult>;
}
