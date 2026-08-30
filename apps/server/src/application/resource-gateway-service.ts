import { randomUUID } from "node:crypto";
import type { TraceSink } from "../domain/ports.js";
import type { ToolAccessDecision } from "../domain/tool-access.js";
import { HttpError } from "../errors.js";
import type { AccessGrantService } from "./access-grant-service.js";
import type { FixtureResourceStore } from "./fixture-resource-store.js";
import type { ToolPolicyService } from "./tool-policy-service.js";

export class ResourceGatewayService {
  constructor(private readonly grants: AccessGrantService, private readonly policy: ToolPolicyService, private readonly resources: FixtureResourceStore, private readonly traceSink: TraceSink, private readonly traceIdForSession: (sessionId: string) => Promise<string>, private readonly now: () => string = () => new Date().toISOString()) {}
  async readResource(input: { grantId: string; resource: string }): Promise<{ content: string; contentType: string; sourceRef: string }> {
    const grant = await this.grants.getGrant(input.grantId);
    const request = { requestId: randomUUID(), grantId: input.grantId, tool: "resource.read" as const, resource: input.resource, operation: "read" as const, timestamp: this.now() };
    const decision = this.policy.evaluate(grant, request);
    if (grant) await this.trace(grant, "tool.access.requested", input.resource, decision);
    if (decision.decision === "DENY") {
      if (grant) await this.trace(grant, "tool.access.denied", input.resource, decision);
      throw new HttpError(403, `RESOURCE_ACCESS_DENIED: ${decision.reason}`);
    }
    await this.trace(grant!, "tool.access.allowed", input.resource, decision);
    const result = await this.resources.read(input.resource);
    return { ...result, sourceRef: `resource://${input.resource}` };
  }
  private async trace(grant: NonNullable<Awaited<ReturnType<AccessGrantService["getGrant"]>>>, type: "tool.access.requested" | "tool.access.allowed" | "tool.access.denied", resource: string, decision: ToolAccessDecision) {
    await this.traceSink.append({ id: `${grant.sessionId}:${type}:${randomUUID()}`, traceId: await this.traceIdForSession(grant.sessionId), sessionId: grant.sessionId, taskId: grant.taskId, agentId: grant.agentId, type, timestamp: this.now(), metadata: { tool: "resource.read", resource, operation: "read", decision: decision.decision, reason: decision.reason } });
  }
}
