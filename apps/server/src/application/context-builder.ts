import type { EvidenceRecord } from "../domain/evidence.js";
import type { ExecutionContext } from "../domain/ports.js";
import type { AgentTask } from "../domain/task.js";

export interface ContextCapsuleInput {
  sessionId: string;
  goal: string;
  currentTask: AgentTask;
  constraints: readonly string[];
  allowedResources: readonly string[];
  evidence: readonly EvidenceRecord[];
}

/**
 * Builds the entire downstream context explicitly. It intentionally has no access
 * to transcript history or arbitrary workflow state.
 */
export function buildContextCapsule(input: ContextCapsuleInput): ExecutionContext {
  const allowedDependencies = new Set(input.currentTask.dependsOn);
  const dependencyEvidence = input.evidence
    .filter((record) =>
      record.sessionId === input.sessionId
      && allowedDependencies.has(record.taskId)
      && record.status === "accepted",
    )
    .map((record) => ({ ...record, sourceRefs: [...record.sourceRefs] }));

  return {
    sessionId: input.sessionId,
    taskId: input.currentTask.id,
    goal: input.goal,
    constraints: [...input.constraints],
    allowedResources: [...input.allowedResources],
    dependencyEvidence,
  };
}
