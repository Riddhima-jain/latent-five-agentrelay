import { describe, expect, it } from "vitest";
import type { AgentTask, TaskStatus } from "../domain/task.js";
import { canTransitionTask, transitionTask } from "./task-lifecycle.js";

function makeTask(status: TaskStatus = "blocked", attempt = 0): AgentTask {
  return {
    id: "research",
    sessionId: "session-1",
    title: "Market Research",
    requiredCapability: "market_research",
    requiredPermissions: ["read"],
    dependsOn: [],
    status,
    attempt,
    maxAttempts: 2,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

function transitioned(result: ReturnType<typeof transitionTask>): AgentTask {
  expect(result).toMatchObject({ transitioned: true });
  if (!result.transitioned) throw new Error("Expected a successful transition");
  return result.task;
}

describe("task lifecycle", () => {
  it("moves a task through blocked, ready, running, and completed", () => {
    const ready = transitioned(transitionTask(makeTask(), "ready", "2026-08-29T00:01:00.000Z"));
    const running = transitioned(transitionTask(ready, "running", "2026-08-29T00:02:00.000Z"));
    const completed = transitioned(transitionTask(running, "completed", "2026-08-29T00:03:00.000Z"));

    expect(ready.status).toBe("ready");
    expect(running).toMatchObject({ status: "running", attempt: 1 });
    expect(completed).toMatchObject({ status: "completed", attempt: 1 });
  });

  it("allows a running task to reach failed", () => {
    const failed = transitioned(transitionTask(makeTask("running", 1), "failed", "2026-08-29T00:01:00.000Z"));

    expect(failed.status).toBe("failed");
  });

  it("does not allow a blocked task to start", () => {
    expect(transitionTask(makeTask("blocked"), "running", "2026-08-29T00:01:00.000Z")).toEqual({
      transitioned: false,
      error: {
        code: "INVALID_TASK_STATE_TRANSITION",
        from: "blocked",
        to: "running",
      },
    });
  });

  it("does not allow transitions from terminal states", () => {
    expect(canTransitionTask("completed", "running")).toBe(false);
    expect(transitionTask(makeTask("failed", 1), "ready", "2026-08-29T00:01:00.000Z")).toMatchObject({
      transitioned: false,
      error: { code: "INVALID_TASK_STATE_TRANSITION" },
    });
  });

  it("returns a failed attempt to ready before retrying", () => {
    const readyToRetry = transitioned(
      transitionTask(makeTask("running", 1), "ready", "2026-08-29T00:01:00.000Z"),
    );
    const retried = transitioned(transitionTask(readyToRetry, "running", "2026-08-29T00:02:00.000Z"));

    expect(retried).toMatchObject({ status: "running", attempt: 2 });
  });

  it("prevents starting after max attempts are exhausted", () => {
    expect(transitionTask(makeTask("ready", 2), "running", "2026-08-29T00:01:00.000Z")).toEqual({
      transitioned: false,
      error: {
        code: "MAX_ATTEMPTS_EXHAUSTED",
        from: "ready",
        to: "running",
      },
    });
  });
});
