import type { AgentTask } from "../domain/task.js";
import { transitionTask } from "./task-lifecycle.js";

export interface SchedulingResult {
  tasks: AgentTask[];
  /** All ready tasks, in task-list order, may be invoked concurrently by a coordinator. */
  readyTaskIds: string[];
  /** Blocked tasks whose dependencies include a terminal failure; they are never unlocked. */
  blockedByFailedDependencyTaskIds: string[];
}

/**
 * Reconciles dependency readiness without invoking agents or mutating its input.
 * A valid DAG is a precondition; unknown dependencies remain unsatisfied as a safe fallback.
 */
export function scheduleReadyTasks(
  tasks: readonly AgentTask[],
  updatedAt: string,
): SchedulingResult {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const blockedByFailedDependencyTaskIds: string[] = [];

  const scheduledTasks = tasks.map((task) => {
    if (task.status !== "blocked") return task;

    const dependencies = task.dependsOn.map((dependencyId) => tasksById.get(dependencyId));
    if (dependencies.some((dependency) => dependency?.status === "failed")) {
      blockedByFailedDependencyTaskIds.push(task.id);
      return task;
    }

    if (!dependencies.every((dependency) => dependency?.status === "completed")) {
      return task;
    }

    const transition = transitionTask(task, "ready", updatedAt);
    if (!transition.transitioned) return task;
    return transition.task;
  });

  return {
    tasks: scheduledTasks,
    readyTaskIds: scheduledTasks
      .filter((task) => task.status === "ready")
      .map((task) => task.id),
    blockedByFailedDependencyTaskIds,
  };
}
