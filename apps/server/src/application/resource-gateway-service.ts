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

export interface ResourceAccessAuditSink {
  record(event: {
    type: "tool.access.requested" | "tool.access.allowed" | "tool.access.denied";
    grantId: string;
    sessionId?: string;
    taskId?: string;
    agentId?: string;
    resource: string;
    decision?: "ALLOW" | "DENY";
    reason?: ToolAccessDecision["reason"];
  }): Promise<void>;
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
    private readonly audit?: ResourceAccessAuditSink,
  ) {}

  async readResource(input: { grantId: string; resource: string }): Promise<ResourceReadResult> {
    const grant = await this.grants.getGrant(input.grantId);
    if (!grant) {
      await this.audit?.record({ type: "tool.access.denied", grantId: input.grantId, resource: input.resource, decision: "DENY", reason: "INVALID_GRANT" });
      throw new ResourceAccessError("INVALID_GRANT");
    }
    const auditBase = { grantId: input.grantId, sessionId: grant.sessionId, taskId: grant.taskId, agentId: grant.agentId, resource: input.resource };
    await this.audit?.record({ type: "tool.access.requested", ...auditBase });
    let resource: string;
    try { resource = normalizeLogicalResource(input.resource); } catch {
      await this.audit?.record({ type: "tool.access.denied", ...auditBase, decision: "DENY", reason: "RESOURCE_OUT_OF_SCOPE" });
      throw new ResourceAccessError("RESOURCE_OUT_OF_SCOPE");
    }
    const decision = this.policy.evaluate(grant, {
      requestId: randomUUID(), grantId: input.grantId, tool: "resource.read", resource, operation: "read", timestamp: this.now(),
    });
    if (decision.decision === "DENY") {
      await this.audit?.record({ type: "tool.access.denied", ...auditBase, resource, decision: "DENY", reason: decision.reason });
      throw new ResourceAccessError(decision.reason);
    }
    const result = { ...(await this.resources.read(resource)), resource };
    await this.audit?.record({ type: "tool.access.allowed", ...auditBase, resource, decision: "ALLOW", reason: decision.reason });
    return result;
  }
}
