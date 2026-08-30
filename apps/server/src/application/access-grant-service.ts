import { randomUUID } from "node:crypto";
import type { AgentManifest } from "../domain/capability.js";
import type { AccessGrant } from "../domain/tool-access.js";

export interface AccessGrantService {
  issueGrant(input: { sessionId: string; taskId: string; agent: AgentManifest }): Promise<AccessGrant>;
  getGrant(grantId: string): Promise<AccessGrant | null>;
  revokeGrant(grantId: string): Promise<void>;
}

export class InMemoryAccessGrantService implements AccessGrantService {
  private readonly grants = new Map<string, AccessGrant>();

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => randomUUID(),
  ) {}

  async issueGrant(input: { sessionId: string; taskId: string; agent: AgentManifest }): Promise<AccessGrant> {
    if (input.agent.toolPolicy.agentId !== input.agent.agentId) throw new Error("Manifest tool policy must be bound to its Agent ID");
    const grant: AccessGrant = {
      id: this.createId(), sessionId: input.sessionId, taskId: input.taskId, agentId: input.agent.agentId,
      allowedTools: [...input.agent.toolPolicy.allowedTools],
      resourceScopes: input.agent.toolPolicy.resourceScopes.map((scope) => ({ ...scope, permissions: [...scope.permissions] })),
      status: "active", createdAt: this.now(),
    };
    this.grants.set(grant.id, grant);
    return cloneGrant(grant);
  }

  async getGrant(grantId: string): Promise<AccessGrant | null> {
    const grant = this.grants.get(grantId);
    return grant ? cloneGrant(grant) : null;
  }

  async revokeGrant(grantId: string): Promise<void> {
    const grant = this.grants.get(grantId);
    if (grant) this.grants.set(grantId, { ...grant, status: "revoked" });
  }
}

export function cloneGrant(grant: AccessGrant): AccessGrant {
  return { ...grant, allowedTools: [...grant.allowedTools], resourceScopes: grant.resourceScopes.map((scope) => ({ ...scope, permissions: [...scope.permissions] })) };
}
