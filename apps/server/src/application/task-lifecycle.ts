import type { AgentTask, TaskStatus } from "../domain/task.js";

export type TaskTransitionErrorCode =
  | "INVALID_TASK_STATE_TRANSITION"
  | "MAX_ATTEMPTS_EXHAUSTED";

export type TaskTransitionResult =
  | { transitioned: true; task: AgentTask }
  | {
      transitioned: false;
      error: {
        code: TaskTransitionErrorCode;
        from: TaskStatus;
        to: TaskStatus;
      };
    };

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  blocked: ["ready"],
  ready: ["running", "unassigned"],
  running: ["ready", "approval_required", "completed", "failed"],
  approval_required: ["running", "completed", "failed"],
  completed: [],
  failed: [],
  skipped: [],
  unassigned: ["ready", "failed"],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Applies one allowed lifecycle transition without mutating the stored task.
 * An attempt starts only when a ready task moves to running; retry policy decides
 * whether a running task is first returned to ready.
 */
export function transitionTask(
  task: AgentTask,
  nextStatus: TaskStatus,
  updatedAt: string,
): TaskTransitionResult {
  if (!canTransitionTask(task.status, nextStatus)) {
    return {
      transitioned: false,
      error: {
        code: "INVALID_TASK_STATE_TRANSITION",
        from: task.status,
        to: nextStatus,
      },
    };
  }

  if (task.status === "ready" && nextStatus === "running" && task.attempt >= task.maxAttempts) {
    return {
      transitioned: false,
      error: {
        code: "MAX_ATTEMPTS_EXHAUSTED",
        from: task.status,
        to: nextStatus,
      },
    };
  }

  return {
    transitioned: true,
    task: {
      ...task,
      status: nextStatus,
      attempt: task.status === "ready" && nextStatus === "running" ? task.attempt + 1 : task.attempt,
      updatedAt,
    },
  };
}
