export type AutomationDecision =
  | "AUTO_EXECUTE"
  | "REQUIRE_APPROVAL"
  | "RECOMMEND_ONLY"
  | "DENY";

/** Action names are untrusted until resolved against the server-side registry. */
export type RegisteredActionType =
  | "CREATE_INTERNAL_DRAFT"
  | "SEND_EMAIL"
  | "UPDATE_PRICING"
  | "DELETE_PROTECTED_DATA";

export type ActionImpact = "low" | "high" | "critical";
export type ActionReversibility = "reversible" | "irreversible";
export type ActionTargetScope = "internal" | "external" | "protected";

/**
 * Trusted metadata. It must be selected by the server registry, never accepted
 * from an agent-provided action payload.
 */
export interface ActionRiskMetadata {
  impact: ActionImpact;
  reversibility: ActionReversibility;
  targetScope: ActionTargetScope;
  requiredPermission: import("./capability.js").AgentPermission;
  prohibited: boolean;
}

export type ActionExecutionStatus = "pending" | "executing" | "succeeded" | "failed";

/** A proposed action is untrusted until the server derives its policy decision. */
export interface ProposedAction {
  id: string;
  sessionId: string;
  taskId: string;
  producerAgentId: string;
  type: string;
  target: string;
  payload: unknown;
  rationale?: string;
  createdAt: string;
}

/** The exact immutable action shape accepted by the trusted executor. */
export interface ApprovedAction extends ProposedAction {
  payloadHash: string;
  idempotencyKey: string;
}

export interface ActionResult {
  status: ActionExecutionStatus;
  externalReference?: string;
  error?: string;
}
