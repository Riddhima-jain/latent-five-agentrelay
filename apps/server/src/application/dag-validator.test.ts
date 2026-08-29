import { describe, expect, it } from "vitest";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { WorkflowTaskDefinition } from "../domain/task.js";
import { validateTaskDag } from "./dag-validator.js";

const knownCapabilities = new Set(
  SALES_RECOVERY_AGENTS.flatMap((agent) => agent.capabilities),
);

function task(
  overrides: Partial<WorkflowTaskDefinition> & Pick<WorkflowTaskDefinition, "id">,
): WorkflowTaskDefinition {
  return {
    id: overrides.id,
    title: "Test task",
    requiredCapability: "market_research",
    requiredPermissions: ["read"],
    dependsOn: [],
    maxAttempts: 1,
    ...overrides,
  };
}

describe("validateTaskDag", () => {
  it("accepts the frozen sales-recovery DAG in deterministic topological order", () => {
    expect(validateTaskDag(SALES_RECOVERY_TASKS, knownCapabilities)).toEqual({
      valid: true,
      topologicalOrder: ["research", "finance", "strategy", "outreach"],
    });
  });

  it("rejects duplicate task IDs", () => {
    const result = validateTaskDag([task({ id: "research" }), task({ id: "research" })], knownCapabilities);

    expect(result).toMatchObject({
      valid: false,
      errors: [{ code: "DUPLICATE_TASK_ID", taskId: "research" }],
    });
  });

  it("rejects an unknown dependency", () => {
    const result = validateTaskDag([task({ id: "strategy", dependsOn: ["missing"] })], knownCapabilities);

    expect(result).toMatchObject({
      valid: false,
      errors: [{ code: "UNKNOWN_DEPENDENCY", taskId: "strategy", dependencyId: "missing" }],
    });
  });

  it("rejects a self dependency", () => {
    const result = validateTaskDag([task({ id: "research", dependsOn: ["research"] })], knownCapabilities);

    expect(result).toMatchObject({
      valid: false,
      errors: [{ code: "SELF_DEPENDENCY", taskId: "research", dependencyId: "research" }],
    });
  });

  it("rejects an unknown capability", () => {
    const result = validateTaskDag([task({ id: "unknown", requiredCapability: "not_registered" })], knownCapabilities);

    expect(result).toMatchObject({
      valid: false,
      errors: [{ code: "UNKNOWN_CAPABILITY", taskId: "unknown", capability: "not_registered" }],
    });
  });

  it("rejects cycles", () => {
    const result = validateTaskDag([
      task({ id: "research", dependsOn: ["strategy"] }),
      task({ id: "strategy", dependsOn: ["research"] }),
    ], knownCapabilities);

    expect(result).toMatchObject({
      valid: false,
      errors: [{ code: "CYCLIC_DEPENDENCY", cycleTaskIds: ["research", "strategy"] }],
    });
  });
});
