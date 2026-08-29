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

/**
 * Trust-owned outcome for deciding whether provisional evidence may propagate.
 * `accepted` means eligible for the declared workflow path, not factually true.
 */
export interface EvidenceAcceptance {
  status: Extract<EvidenceStatus, "accepted" | "rejected">;
  reasons: string[];
}
