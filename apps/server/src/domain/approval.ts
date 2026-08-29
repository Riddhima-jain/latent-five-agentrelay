export type ApprovalStatus = "pending" | "approved" | "denied" | "invalidated";

/** payloadHash binds approval to the action type, target, and canonical payload. */
export interface ApprovalRecord {
  id: string;
  actionId: string;
  payloadHash: string;
  sessionId: string;
  status: ApprovalStatus;
  createdAt: string;
  approvedAt?: string;
  deniedAt?: string;
  invalidatedAt?: string;
}
