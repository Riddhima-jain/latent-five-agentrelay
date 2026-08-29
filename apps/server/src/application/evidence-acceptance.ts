import type { EvidenceAcceptance, EvidenceRecord } from "../domain/evidence.js";
import type { AgentTask } from "../domain/task.js";

/**
 * Applies P2's deterministic propagation rule to one provisional record.
 * The LLM cannot self-accept evidence: task state and assigned producer are trusted inputs.
 */
export function assessEvidence(record: EvidenceRecord, producerTask: AgentTask): EvidenceAcceptance {
  const reasons: string[] = [];
  if (record.sessionId !== producerTask.sessionId) reasons.push("Evidence belongs to a different workflow session");
  if (record.taskId !== producerTask.id) reasons.push("Evidence does not belong to the producer task");
  if (producerTask.status !== "completed") reasons.push("Producer task did not complete successfully");
  if (producerTask.assignedAgentId !== record.producerAgentId) reasons.push("Evidence producer does not match the assigned agent");
  if (record.claim.trim().length === 0) reasons.push("Evidence claim is missing");
  if (record.sourceRefs.length === 0 || record.sourceRefs.some((sourceRef) => sourceRef.trim().length === 0)) {
    reasons.push("Evidence requires at least one valid source reference");
  }
  return reasons.length === 0 ? { status: "accepted", reasons: [] } : { status: "rejected", reasons };
}

export function applyEvidenceAcceptance(record: EvidenceRecord, producerTask: AgentTask): EvidenceRecord {
  const acceptance = assessEvidence(record, producerTask);
  return { ...record, sourceRefs: [...record.sourceRefs], status: acceptance.status };
}
