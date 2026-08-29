export type EvidenceStatus = "provisional" | "accepted" | "rejected" | "stale";

/** Evidence is eligible for propagation only when its status is accepted. */
export interface EvidenceRecord {
  id: string;
  sessionId: string;
  taskId: string;
  producerAgentId: string;
  status: EvidenceStatus;
  claim: string;
  sourceRefs: string[];
  createdAt: string;
}
