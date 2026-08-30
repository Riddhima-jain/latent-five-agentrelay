export type ToolName = "resource.read";
export type ResourcePermission = "read";

export interface ResourceScope { pattern: string; permissions: ResourcePermission[] }
export interface AgentAccessPolicy { agentId: string; allowedTools: ToolName[]; resourceScopes: ResourceScope[] }
export interface AccessGrant extends AgentAccessPolicy {
  id: string;
  sessionId: string;
  taskId: string;
  status: "active" | "revoked" | "expired";
  expiresAt?: string;
  createdAt: string;
}
export interface ToolAccessRequest {
  requestId: string;
  grantId: string;
  tool: ToolName;
  resource: string;
  operation: ResourcePermission;
  timestamp: string;
}
export type ToolAccessDecision =
  | { decision: "ALLOW"; reason: "GRANT_PERMITS_REQUEST" }
  | { decision: "DENY"; reason: "INVALID_GRANT" | "GRANT_REVOKED" | "GRANT_EXPIRED" | "TOOL_NOT_ALLOWED" | "RESOURCE_OUT_OF_SCOPE" | "OPERATION_NOT_ALLOWED" };
