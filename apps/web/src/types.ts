export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  } | null;
  createdAt: string;
}

export interface SystemInfo {
  modelProvider: "ark" | "gemini";
  modelConfigured: boolean;
  modelBaseUrl: string;
  model: string | null;
  codexAvailable: boolean;
  codexSandboxMode: string;
  runtimeProvider: "local-process" | "container";
  containerEngine: string | null;
  runtime: string;
}

export type RelayTaskStatus =
  | "waiting"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "approval_required"
  | "denied";

export interface RelayTask {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  status: RelayTaskStatus;
  dependsOn: string[];
  summary?: string;
  durationMs?: number;
}

export type RelayDecision =
  | "AUTO_EXECUTE"
  | "REQUIRE_APPROVAL"
  | "RECOMMEND_ONLY"
  | "DENY";

export interface RelayApproval {
  id: string;
  actionId: string;
  actionHash: string;
  status: "pending" | "approved" | "denied" | "invalidated";
  decision: RelayDecision;
  actionType: "SEND_EMAIL";
  recipient: string;
  subject: string;
  body: string;
  rationale: string;
}

export interface RelayTraceEvent {
  id: string;
  type: string;
  timestamp: string;
  taskId?: string;
  agentId?: string;
  summary: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface RelaySession {
  id: string;
  traceId: string;
  title: string;
  status: "running" | "awaiting_approval" | "completed" | "failed" | "degraded";
  startedAt: string;
  tasks: RelayTask[];
  approval: RelayApproval | null;
  trace: RelayTraceEvent[];
}
