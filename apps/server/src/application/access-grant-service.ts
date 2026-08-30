import { randomBytes } from "node:crypto";
import type { AgentManifest } from "../domain/capability.js";
import type { AccessGrant } from "../domain/tool-access.js";

export class AccessGrantService {
  private readonly grants = new Map<string, AccessGrant>();
  constructor(private readonly now: () => Date = () => new Date(), private readonly token: () => string = () => randomBytes(32).toString("base64url"), private readonly ttlMs = 15 * 60_000) {}
  async issueGrant(input: { sessionId: string; taskId: string; agent: AgentManifest }): Promise<AccessGrant> {
    const created = this.now();
    const grant: AccessGrant = { id: this.token(), sessionId: input.sessionId, taskId: input.taskId, agentId: input.agent.agentId, allowedTools: [...(input.agent.toolPolicy?.allowedTools ?? [])], resourceScopes: (input.agent.toolPolicy?.resourceScopes ?? []).map((scope) => ({ ...scope, permissions: [...scope.permissions] })), status: "active", createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + this.ttlMs).toISOString() };
    this.grants.set(grant.id, grant);
    return structuredClone(grant);
  }
  async getGrant(id: string): Promise<AccessGrant | null> { return structuredClone(this.grants.get(id) ?? null); }
  async revokeGrant(id: string): Promise<void> { const grant = this.grants.get(id); if (grant) this.grants.set(id, { ...grant, status: "revoked" }); }
}
