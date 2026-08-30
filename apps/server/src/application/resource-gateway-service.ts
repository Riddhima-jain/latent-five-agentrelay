import { randomUUID } from "node:crypto";
import type { ToolAccessDecision } from "../domain/tool-access.js";
import type { AccessGrantService } from "./access-grant-service.js";
import type { ProtectedResourceStore } from "./fixture-resource-store.js";
import { normalizeLogicalResource, type ToolPolicyService } from "./tool-policy-service.js";

export interface ResourceReadResult {
  content: string;
  contentType: string;
  resource: string;
}

export interface ResourceGatewayService {
  readResource(input: { grantId: string; resource: string }): Promise<ResourceReadResult>;
}

export class ResourceAccessError extends Error {
  constructor(readonly reason: Extract<ToolAccessDecision, { decision: "DENY" }> ["reason"]) {
    super(`RESOURCE_ACCESS_DENIED: ${reason}`);
    this.name = "ResourceAccessError";
  }
}

export class ProtectedResourceGatewayService implements ResourceGatewayService {
  constructor(
    private readonly grants: AccessGrantService,
    private readonly policy: ToolPolicyService,
    private readonly resources: ProtectedResourceStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async readResource(input: { grantId: string; resource: string }): Promise<ResourceReadResult> {
    const grant = await this.grants.getGrant(input.grantId);
    if (!grant) throw new ResourceAccessError("INVALID_GRANT");
    let resource: string;
    try { resource = normalizeLogicalResource(input.resource); } catch { throw new ResourceAccessError("RESOURCE_OUT_OF_SCOPE"); }
    const decision = this.policy.evaluate(grant, {
      requestId: randomUUID(), grantId: input.grantId, tool: "resource.read", resource, operation: "read", timestamp: this.now(),
    });
    if (decision.decision === "DENY") throw new ResourceAccessError(decision.reason);
    return { ...(await this.resources.read(resource)), resource };
  }
}
