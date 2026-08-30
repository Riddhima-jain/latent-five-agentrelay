import type { AgentManifest, AgentPermission } from "../domain/capability.js";

export interface StarterKitAgent {
  id: string;
  status: "ready" | "busy" | "stopped" | "error";
}

/** Reads persisted Starter Kit Agents without granting AgentRelay permissions. */
export interface StarterKitAgentLookup {
  get(agentId: string): Promise<StarterKitAgent | null>;
}

export interface AgentManifestRegistry {
  get(agentId: string): Promise<AgentManifest | null>;
  list(): Promise<AgentManifest[]>;
  findEligible(input: {
    capability: string;
    requiredPermissions?: AgentPermission[];
  }): Promise<AgentManifest[]>;
}

export type AgentManifestRegistryErrorCode = "AGENT_NOT_FOUND" | "AGENT_NOT_RUNNABLE";

export class AgentManifestRegistryError extends Error {
  constructor(
    readonly code: AgentManifestRegistryErrorCode,
    readonly agentId: string,
  ) {
    super(`${code}: ${agentId}`);
    this.name = "AgentManifestRegistryError";
  }
}

/**
 * Links explicitly registered AgentRelay manifests to persisted Starter Kit Agents.
 * An Agent that exists in Starter Kit but has no manifest deliberately remains absent.
 */
export class PersistedAgentManifestRegistry implements AgentManifestRegistry {
  private readonly manifestsByAgentId = new Map<string, AgentManifest>();

  constructor(
    manifests: readonly AgentManifest[],
    private readonly starterKitAgents: StarterKitAgentLookup,
  ) {
    for (const manifest of manifests) {
      if (this.manifestsByAgentId.has(manifest.agentId)) {
        throw new Error(`Duplicate AgentRelay manifest: ${manifest.agentId}`);
      }
      this.manifestsByAgentId.set(manifest.agentId, cloneManifest(manifest));
    }
  }

  async get(agentId: string): Promise<AgentManifest | null> {
    const manifest = this.manifestsByAgentId.get(agentId);
    if (!manifest) return null;

    const persistedAgent = await this.starterKitAgents.get(agentId);
    if (!persistedAgent || persistedAgent.id !== agentId) {
      throw new AgentManifestRegistryError("AGENT_NOT_FOUND", agentId);
    }
    if (!manifest.runnable || persistedAgent.status !== "ready") {
      throw new AgentManifestRegistryError("AGENT_NOT_RUNNABLE", agentId);
    }
    return cloneManifest(manifest);
  }

  async list(): Promise<AgentManifest[]> {
    const manifests = await Promise.all([...this.manifestsByAgentId.keys()].map((agentId) => this.get(agentId)));
    return manifests.filter((manifest): manifest is AgentManifest => manifest !== null);
  }

  async findEligible(input: {
    capability: string;
    requiredPermissions?: AgentPermission[];
  }): Promise<AgentManifest[]> {
    const requiredPermissions = input.requiredPermissions ?? [];
    const matches = [...this.manifestsByAgentId.values()].filter((manifest) =>
      manifest.capabilities.includes(input.capability)
      && requiredPermissions.every((permission) => manifest.permissions.includes(permission)),
    );
    const eligible: AgentManifest[] = [];
    for (const manifest of matches) {
      try {
        const verifiedManifest = await this.get(manifest.agentId);
        if (verifiedManifest) eligible.push(verifiedManifest);
      } catch (error) {
        if (!(error instanceof AgentManifestRegistryError)) throw error;
        // Candidate manifests with an unavailable persisted Agent are not eligible.
      }
    }
    return eligible;
  }
}

function cloneManifest(manifest: AgentManifest): AgentManifest {
  return {
    ...manifest,
    capabilities: [...manifest.capabilities],
    permissions: [...manifest.permissions],
  };
}
