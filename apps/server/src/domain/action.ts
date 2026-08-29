export type AutomationDecision =
  | "AUTO_EXECUTE"
  | "REQUIRE_APPROVAL"
  | "RECOMMEND_ONLY"
  | "DENY";

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
