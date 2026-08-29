export type ApprovalStatus = "pending" | "approved" | "denied" | "invalidated";

/** actionHash binds approval to action type, target, and canonical payload. */
export interface ApprovalRecord {
  id: string;
  actionId: string;
  actionHash: string;
  sessionId: string;
  status: ApprovalStatus;
  approvedAt?: string;
  deniedAt?: string;
  invalidatedAt?: string;
}
