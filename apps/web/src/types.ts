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
  startedAt?: string;
  completedAt?: string;
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

export interface RelayAgentManifestView {
  agentId: string;
  name: string;
  capabilities: string[];
  runnable: boolean;
  allowedTools: Array<"resource.read">;
  resourceScopes: string[];
}

export interface PolicySimulationResult {
  agentId: string;
  agentName: string;
  tool: "resource.read";
  resource: string;
  operation: "read";
  decision: "ALLOW" | "DENY";
  reason: string;
  allowedTools: Array<"resource.read">;
  resourceScopes: string[];
  dryRun: true;
}

export type RelayResourceAccessReason =
  | "GRANT_PERMITS_REQUEST"
  | "INVALID_GRANT"
  | "GRANT_REVOKED"
  | "GRANT_EXPIRED"
  | "TOOL_NOT_ALLOWED"
  | "RESOURCE_OUT_OF_SCOPE"
  | "OPERATION_NOT_ALLOWED";

export interface RelayResourceAccessEvent {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  taskId: string;
  tool: "resource.read";
  resource: string;
  operation: "read";
  decision: "ALLOW" | "DENY";
  reason: RelayResourceAccessReason;
}

export interface RelayRecommendationView {
  id: string;
  taskId: string;
  actionType: string;
  summary: string;
  decision: "RECOMMEND_ONLY";
  reasons: string[];
  supportingEvidenceIds: string[];
}

export interface RelaySession {
  id: string;
  traceId: string;
  title: string;
  goal: string;
  status: "running" | "awaiting_approval" | "completed" | "failed" | "degraded";
  startedAt: string;
  tasks: RelayTask[];
  approval: RelayApproval | null;
  trace: RelayTraceEvent[];
  evidence?: Array<{
    id: string;
    taskId: string;
    claim: string;
    sourceRefs: string[];
    status: string;
    reasons: string[];
    createdAt: string;
  }>;
  receipts?: Array<{
    actionId: string;
    provider: "mock" | "resend";
    externalReference: string;
    acceptedAt: string;
  }>;
  agentManifests?: RelayAgentManifestView[];
  resourceAccessEvents?: RelayResourceAccessEvent[];
  recommendations?: RelayRecommendationView[];
  contextCapsules?: RelayContextCapsuleView[];
  idempotency?: { concurrentRequests: number; claimsWon: number; duplicatesRejected: number; sends: number };
}

export interface RelayContextCapsuleView {
  taskId: string;
  agentId: string;
  agentName: string;
  goal: string;
  dependencyTaskIds: string[];
  includedEvidence: Array<{ id: string; taskId: string; claim: string; sourceRefs: string[]; producerAgentId: string }>;
  excludedEvidence: Array<{ id: string; taskId: string; claim: string; producerAgentId: string; status: string; reasons: string[] }>;
}
