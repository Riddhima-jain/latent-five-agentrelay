import type { AgentService } from "../agent-service.js";
import type { AgentManifest } from "../domain/capability.js";
import { HttpError } from "../errors.js";

export class AgentManifestRegistry {
  constructor(private readonly agentService: Pick<AgentService, "getAgent" | "listAgents">, private readonly manifests: readonly AgentManifest[]) {}

  async get(agentId: string): Promise<AgentManifest | null> {
    const manifest = this.manifests.find((item) => item.agentId === agentId);
    if (!manifest) return null;
    let agent;
    try { agent = this.agentService.getAgent(agentId); } catch { throw new HttpError(409, `AGENT_NOT_FOUND: ${agentId}`); }
    return { ...manifest, runnable: agent.status === "ready", capabilities: [...manifest.capabilities], permissions: [...manifest.permissions], ...(manifest.toolPolicy ? { toolPolicy: { allowedTools: [...manifest.toolPolicy.allowedTools], resourceScopes: manifest.toolPolicy.resourceScopes.map((scope) => ({ ...scope, permissions: [...scope.permissions] })) } } : {}) };
  }

  async list(): Promise<AgentManifest[]> {
    return Promise.all(this.manifests.map(async (manifest) => (await this.get(manifest.agentId))!));
  }

  async findEligible(input: { capability: string; requiredPermissions?: string[] }): Promise<AgentManifest[]> {
    const registered = await this.list();
    return registered.filter((manifest) => manifest.runnable && manifest.capabilities.includes(input.capability) && (input.requiredPermissions ?? []).every((permission) => manifest.permissions.includes(permission as never)));
  }

  async requireRunnable(agentId: string): Promise<AgentManifest> {
    const manifest = await this.get(agentId);
    if (!manifest) throw new HttpError(409, `AGENT_NOT_REGISTERED: ${agentId}`);
    if (!manifest.runnable) throw new HttpError(409, `AGENT_NOT_RUNNABLE: ${agentId}`);
    return manifest;
  }
}
