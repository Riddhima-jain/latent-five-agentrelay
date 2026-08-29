import type { WorkflowTaskDefinition } from "../domain/task.js";

export type DagValidationErrorCode =
  | "DUPLICATE_TASK_ID"
  | "UNKNOWN_DEPENDENCY"
  | "SELF_DEPENDENCY"
  | "UNKNOWN_CAPABILITY"
  | "CYCLIC_DEPENDENCY";

export interface DagValidationError {
  code: DagValidationErrorCode;
  message: string;
  taskId?: string;
  dependencyId?: string;
  capability?: string;
  cycleTaskIds?: string[];
}

export type DagValidationResult =
  | { valid: true; topologicalOrder: string[] }
  | { valid: false; errors: DagValidationError[] };

/**
 * Validates a static workflow before the coordinator creates a session.
 * The returned topological order is deterministic: ties retain task-definition order.
 */
export function validateTaskDag(
  tasks: readonly WorkflowTaskDefinition[],
  knownCapabilities: ReadonlySet<string>,
): DagValidationResult {
  const errors: DagValidationError[] = [];
  const tasksById = new Map<string, WorkflowTaskDefinition>();

  for (const task of tasks) {
    if (tasksById.has(task.id)) {
      errors.push({
        code: "DUPLICATE_TASK_ID",
        message: `Task ID "${task.id}" is declared more than once.`,
        taskId: task.id,
      });
      continue;
    }
    tasksById.set(task.id, task);
  }

  for (const task of tasksById.values()) {
    if (!knownCapabilities.has(task.requiredCapability)) {
      errors.push({
        code: "UNKNOWN_CAPABILITY",
        message: `Task "${task.id}" requires unknown capability "${task.requiredCapability}".`,
        taskId: task.id,
        capability: task.requiredCapability,
      });
    }

    for (const dependencyId of task.dependsOn) {
      if (dependencyId === task.id) {
        errors.push({
          code: "SELF_DEPENDENCY",
          message: `Task "${task.id}" cannot depend on itself.`,
          taskId: task.id,
          dependencyId,
        });
      } else if (!tasksById.has(dependencyId)) {
        errors.push({
          code: "UNKNOWN_DEPENDENCY",
          message: `Task "${task.id}" depends on unknown task "${dependencyId}".`,
          taskId: task.id,
          dependencyId,
        });
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  const dependents = new Map<string, string[]>();
  const unmetDependencyCount = new Map<string, number>();
  for (const task of tasksById.values()) {
    dependents.set(task.id, []);
    unmetDependencyCount.set(task.id, task.dependsOn.length);
  }
  for (const task of tasksById.values()) {
    for (const dependencyId of task.dependsOn) {
      dependents.get(dependencyId)?.push(task.id);
    }
  }

  const ready = [...tasksById.values()]
    .filter((task) => unmetDependencyCount.get(task.id) === 0)
    .map((task) => task.id);
  const topologicalOrder: string[] = [];

  for (let index = 0; index < ready.length; index += 1) {
    const taskId = ready[index];
    if (taskId === undefined) continue;
    topologicalOrder.push(taskId);
    for (const dependentId of dependents.get(taskId) ?? []) {
      const remaining = (unmetDependencyCount.get(dependentId) ?? 0) - 1;
      unmetDependencyCount.set(dependentId, remaining);
      if (remaining === 0) ready.push(dependentId);
    }
  }

  if (topologicalOrder.length === tasksById.size) {
    return { valid: true, topologicalOrder };
  }

  const cycleTaskIds = [...tasksById.keys()].filter(
    (taskId) => !topologicalOrder.includes(taskId),
  );
  return {
    valid: false,
    errors: [
      {
        code: "CYCLIC_DEPENDENCY",
        message: "Workflow contains a cyclic dependency.",
        cycleTaskIds,
      },
    ],
  };
}
