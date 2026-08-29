import type { AgentManifest } from "../domain/capability.js";
import type { AgentTask } from "../domain/task.js";

export type UnassignedReason =
  | "CAPABILITY_NOT_REGISTERED"
  | "NO_RUNNABLE_AGENT"
  | "INSUFFICIENT_PERMISSIONS";

export type CapabilityRoutingDecision =
  | { status: "ASSIGNED"; agentId: string }
  | { status: "UNASSIGNED"; reason: UnassignedReason };

/**
 * Selects the first eligible manifest in registry order. There is no fuzzy capability
 * matching or LLM fallback: an agent must match the exact requested capability.
 */
export function routeTaskByCapability(
  task: Pick<AgentTask, "requiredCapability" | "requiredPermissions">,
  agents: readonly AgentManifest[],
): CapabilityRoutingDecision {
  const capabilityMatches = agents.filter((agent) =>
    agent.capabilities.includes(task.requiredCapability),
  );
  if (capabilityMatches.length === 0) {
    return { status: "UNASSIGNED", reason: "CAPABILITY_NOT_REGISTERED" };
  }

  const runnableMatches = capabilityMatches.filter((agent) => agent.runnable);
  if (runnableMatches.length === 0) {
    return { status: "UNASSIGNED", reason: "NO_RUNNABLE_AGENT" };
  }

  const assignedAgent = runnableMatches.find((agent) =>
    task.requiredPermissions.every((permission) => agent.permissions.includes(permission)),
  );
  if (!assignedAgent) {
    return { status: "UNASSIGNED", reason: "INSUFFICIENT_PERMISSIONS" };
  }

  return { status: "ASSIGNED", agentId: assignedAgent.agentId };
}
