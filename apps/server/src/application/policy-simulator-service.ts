import type { AgentManifest } from "../domain/capability.js";
import type { AccessGrant, ResourcePermission, ToolName } from "../domain/tool-access.js";
import { ToolPolicyService } from "./tool-policy-service.js";

export interface PolicySimulationInput {
  agentId: string;
  tool: ToolName;
  resource: string;
  operation: ResourcePermission;
}

export interface PolicySimulationResult extends PolicySimulationInput {
  agentName: string;
  decision: "ALLOW" | "DENY";
  reason: string;
  allowedTools: ToolName[];
  resourceScopes: string[];
  dryRun: true;
}

/** Evaluates the real tool policy with a non-persisted manifest-derived grant. */
export class PolicySimulatorService {
  constructor(private readonly policy: ToolPolicyService = new ToolPolicyService()) {}

  simulate(agent: AgentManifest, input: PolicySimulationInput): PolicySimulationResult {
    const grantId = "agentrelay-policy-simulator";
    const grant: AccessGrant = {
      id: grantId,
      sessionId: "dry-run",
      taskId: "dry-run",
      agentId: agent.agentId,
      allowedTools: [...(agent.toolPolicy?.allowedTools ?? [])],
      resourceScopes: (agent.toolPolicy?.resourceScopes ?? []).map((scope) => ({ ...scope, permissions: [...scope.permissions] })),
      status: "active",
      createdAt: new Date(0).toISOString(),
    };
    const result = this.policy.evaluate(grant, {
      requestId: "dry-run",
      grantId,
      tool: input.tool,
      resource: input.resource,
      operation: input.operation,
      timestamp: new Date(0).toISOString(),
    });
    return {
      ...input,
      agentName: agent.name,
      decision: result.decision,
      reason: result.reason,
      allowedTools: [...grant.allowedTools],
      resourceScopes: grant.resourceScopes.map((scope) => scope.pattern),
      dryRun: true,
    };
  }
}
