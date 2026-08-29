import { describe, expect, it } from "vitest";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { AgentManifest } from "../domain/capability.js";
import type { WorkflowTaskDefinition } from "../domain/task.js";
import { Coordinator, type FakeAgentExecutor } from "./coordinator.js";

class RecordingExecutor implements FakeAgentExecutor {
  readonly calls: Array<{ agentId: string; taskId: string }> = [];

  async execute(agentId: string, task: { id: string }): Promise<void> {
    this.calls.push({ agentId, taskId: task.id });
  }
}

const fixedClock = () => "2026-08-29T00:00:00.000Z";

function statusOf(
  snapshot: ReturnType<Coordinator["getSnapshot"]>,
  taskId: string,
): string | undefined {
  return snapshot.tasks.find((task) => task.id === taskId)?.status;
}

describe("Coordinator", () => {
  it("runs independent roots in parallel and unlocks strategy only after both complete", async () => {
    const executor = new RecordingExecutor();
    const coordinator = new Coordinator(
      SALES_RECOVERY_TASKS,
      SALES_RECOVERY_AGENTS,
      executor,
      fixedClock,
    );

    const started = coordinator.start("session-1");
    expect(started).toMatchObject({
      started: true,
      snapshot: { readyTaskIds: ["research", "finance"] },
    });

    const afterRoots = await coordinator.tick();
    expect(executor.calls).toEqual([
      { agentId: "research-agent", taskId: "research" },
      { agentId: "finance-agent", taskId: "finance" },
    ]);
    expect(statusOf(afterRoots, "research")).toBe("completed");
    expect(statusOf(afterRoots, "finance")).toBe("completed");
    expect(statusOf(afterRoots, "strategy")).toBe("ready");
    expect(statusOf(afterRoots, "outreach")).toBe("blocked");
  });

  it("advances the complete frozen workflow across scheduler ticks", async () => {
    const coordinator = new Coordinator(
      SALES_RECOVERY_TASKS,
      SALES_RECOVERY_AGENTS,
      new RecordingExecutor(),
      fixedClock,
    );
    expect(coordinator.start("session-1")).toMatchObject({ started: true });

    await coordinator.tick();
    const afterStrategy = await coordinator.tick();
    const completed = await coordinator.tick();

    expect(statusOf(afterStrategy, "outreach")).toBe("ready");
    expect(completed.tasks.map((task) => task.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
  });

  it("does not start an invalid workflow", () => {
    const invalidDefinitions: WorkflowTaskDefinition[] = [
      {
        ...SALES_RECOVERY_TASKS[0]!,
        dependsOn: ["research"],
      },
    ];
    const coordinator = new Coordinator(
      invalidDefinitions,
      SALES_RECOVERY_AGENTS,
      new RecordingExecutor(),
      fixedClock,
    );

    expect(coordinator.start("session-1")).toMatchObject({
      started: false,
      errors: [{ code: "SELF_DEPENDENCY" }],
    });
  });

  it("marks a ready task unassigned when no eligible agent exists", async () => {
    const agents: AgentManifest[] = SALES_RECOVERY_AGENTS.filter(
      (agent) => agent.agentId !== "finance-agent",
    );
    const coordinator = new Coordinator(
      SALES_RECOVERY_TASKS,
      agents,
      new RecordingExecutor(),
      fixedClock,
      new Set(SALES_RECOVERY_AGENTS.flatMap((agent) => agent.capabilities)),
    );

    const started = coordinator.start("session-1");
    expect(started).toMatchObject({
      started: true,
    });
    if (!started.started) throw new Error("Expected valid workflow");

    const snapshot = await coordinator.tick();
    expect(statusOf(snapshot, "finance")).toBe("unassigned");
  });

  it("keeps downstream work blocked after an executor failure", async () => {
    const executor: FakeAgentExecutor = {
      async execute(_agentId, task) {
        if (task.id === "research") throw new Error("controlled failure");
      },
    };
    const coordinator = new Coordinator(
      SALES_RECOVERY_TASKS,
      SALES_RECOVERY_AGENTS,
      executor,
      fixedClock,
    );
    expect(coordinator.start("session-1")).toMatchObject({ started: true });

    const snapshot = await coordinator.tick();
    expect(statusOf(snapshot, "research")).toBe("failed");
    expect(statusOf(snapshot, "strategy")).toBe("blocked");
    expect(snapshot.blockedByFailedDependencyTaskIds).toEqual(["strategy"]);
  });
});
