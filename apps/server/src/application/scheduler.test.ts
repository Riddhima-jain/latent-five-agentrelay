import { describe, expect, it } from "vitest";
import { SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { AgentTask, TaskStatus } from "../domain/task.js";
import { scheduleReadyTasks } from "./scheduler.js";

function createTasks(statuses: Partial<Record<string, TaskStatus>> = {}): AgentTask[] {
  return SALES_RECOVERY_TASKS.map((definition) => ({
    ...definition,
    sessionId: "session-1",
    status: statuses[definition.id] ?? "blocked",
    attempt: 0,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  }));
}

function statusOf(tasks: readonly AgentTask[], id: string): TaskStatus | undefined {
  return tasks.find((task) => task.id === id)?.status;
}

describe("scheduleReadyTasks", () => {
  it("unlocks independent root tasks for concurrent scheduling", () => {
    const result = scheduleReadyTasks(createTasks(), "2026-08-29T00:01:00.000Z");

    expect(result.readyTaskIds).toEqual(["research", "finance"]);
    expect(statusOf(result.tasks, "research")).toBe("ready");
    expect(statusOf(result.tasks, "finance")).toBe("ready");
    expect(statusOf(result.tasks, "strategy")).toBe("blocked");
    expect(statusOf(result.tasks, "outreach")).toBe("blocked");
  });

  it("does not unlock strategy until every declared dependency completes", () => {
    const result = scheduleReadyTasks(
      createTasks({ research: "completed", finance: "running" }),
      "2026-08-29T00:01:00.000Z",
    );

    expect(statusOf(result.tasks, "strategy")).toBe("blocked");
    expect(result.readyTaskIds).toEqual([]);
  });

  it("unlocks a downstream task after all dependencies complete", () => {
    const result = scheduleReadyTasks(
      createTasks({ research: "completed", finance: "completed" }),
      "2026-08-29T00:01:00.000Z",
    );

    expect(statusOf(result.tasks, "strategy")).toBe("ready");
    expect(result.readyTaskIds).toEqual(["strategy"]);
  });

  it("keeps downstream work blocked when a dependency fails", () => {
    const result = scheduleReadyTasks(
      createTasks({ research: "failed", finance: "completed" }),
      "2026-08-29T00:01:00.000Z",
    );

    expect(statusOf(result.tasks, "strategy")).toBe("blocked");
    expect(result.blockedByFailedDependencyTaskIds).toEqual(["strategy"]);
  });

  it("does not mutate the input task list", () => {
    const tasks = createTasks();
    const result = scheduleReadyTasks(tasks, "2026-08-29T00:01:00.000Z");

    expect(statusOf(tasks, "research")).toBe("blocked");
    expect(statusOf(result.tasks, "research")).toBe("ready");
  });
});
