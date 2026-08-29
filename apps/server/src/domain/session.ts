/** Shared workflow state. Timestamps use ISO 8601 UTC strings. */
export type SessionStatus =
  | "created"
  | "running"
  | "awaiting_approval"
  | "recommend_only"
  | "degraded"
  | "completed"
  | "failed"
  | "cancelled";

export interface SharedSession {
  id: string;
  goal: string;
  traceId: string;
  participantAgentIds: string[];
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}
