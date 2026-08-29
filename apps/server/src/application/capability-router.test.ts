import { describe, expect, it } from "vitest";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { AgentManifest } from "../domain/capability.js";
import type { WorkflowTaskDefinition } from "../domain/task.js";
import { routeTaskByCapability } from "./capability-router.js";

function definition(
  overrides: Partial<WorkflowTaskDefinition> = {},
): Pick<WorkflowTaskDefinition, "requiredCapability" | "requiredPermissions"> {
  return {
    requiredCapability: "market_research",
    requiredPermissions: ["read"],
    ...overrides,
  };
}

function agent(overrides: Partial<AgentManifest> & Pick<AgentManifest, "agentId">): AgentManifest {
  return {
    agentId: overrides.agentId,
    name: "Test Agent",
    capabilities: ["market_research"],
    permissions: ["read"],
    runnable: true,
    ...overrides,
  };
}

describe("routeTaskByCapability", () => {
  it("routes each frozen workflow task to its matching agent", () => {
    expect(routeTaskByCapability(SALES_RECOVERY_TASKS[0]!, SALES_RECOVERY_AGENTS)).toEqual({
      status: "ASSIGNED",
      agentId: "research-agent",
    });
    expect(routeTaskByCapability(SALES_RECOVERY_TASKS[3]!, SALES_RECOVERY_AGENTS)).toEqual({
      status: "ASSIGNED",
      agentId: "outreach-agent",
    });
  });

  it("requires an exact capability match", () => {
    expect(
      routeTaskByCapability(definition({ requiredCapability: "research" }), SALES_RECOVERY_AGENTS),
    ).toEqual({ status: "UNASSIGNED", reason: "CAPABILITY_NOT_REGISTERED" });
  });

  it("skips an unavailable agent and chooses the next eligible match", () => {
    expect(
      routeTaskByCapability(definition(), [
        agent({ agentId: "stopped", runnable: false }),
        agent({ agentId: "available" }),
      ]),
    ).toEqual({ status: "ASSIGNED", agentId: "available" });
  });

  it("chooses the first eligible agent deterministically", () => {
    expect(
      routeTaskByCapability(definition(), [agent({ agentId: "first" }), agent({ agentId: "second" })]),
    ).toEqual({ status: "ASSIGNED", agentId: "first" });
  });

  it("does not assign an agent without all required permissions", () => {
    expect(
      routeTaskByCapability(
        definition({ requiredPermissions: ["read", "external_write"] }),
        [agent({ agentId: "read-only" })],
      ),
    ).toEqual({ status: "UNASSIGNED", reason: "INSUFFICIENT_PERMISSIONS" });
  });

  it("returns unassigned when capability matches are all unavailable", () => {
    expect(
      routeTaskByCapability(definition(), [agent({ agentId: "stopped", runnable: false })]),
    ).toEqual({ status: "UNASSIGNED", reason: "NO_RUNNABLE_AGENT" });
  });
});
