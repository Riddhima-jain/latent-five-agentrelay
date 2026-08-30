import { describe, expect, it } from "vitest";
import { createDemoAgentManifests } from "./agent-manifest-bootstrap.js";
import { AgentManifestRegistryError, PersistedAgentManifestRegistry, type StarterKitAgent } from "./agent-manifest-registry.js";

const ids = {
  researchAgentId: "agt-research",
  financeAgentId: "agt-finance",
  strategyAgentId: "agt-strategy",
  outreachAgentId: "agt-outreach",
};

function registry(agents: readonly StarterKitAgent[] = Object.values(ids).map((id) => ({ id, status: "ready" as const }))) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return new PersistedAgentManifestRegistry(createDemoAgentManifests(ids), {
    async get(agentId) { return byId.get(agentId) ?? null; },
  });
}

describe("PersistedAgentManifestRegistry", () => {
  it("links every required capability to its real persisted Starter Kit Agent ID", async () => {
    const subject = registry();
    await expect(subject.findEligible({ capability: "market_research" })).resolves.toMatchObject([{ agentId: ids.researchAgentId }]);
    await expect(subject.findEligible({ capability: "financial_analysis" })).resolves.toMatchObject([{ agentId: ids.financeAgentId }]);
    await expect(subject.findEligible({ capability: "strategy" })).resolves.toMatchObject([{ agentId: ids.strategyAgentId }]);
    await expect(subject.findEligible({ capability: "external_communication", requiredPermissions: ["external_write"] })).resolves.toMatchObject([{ agentId: ids.outreachAgentId }]);
  });

  it("rejects a manifest that references a nonexistent Starter Kit Agent", async () => {
    const subject = registry([]);
    await expect(subject.get(ids.researchAgentId)).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" } satisfies Partial<AgentManifestRegistryError>);
  });

  it("rejects a stopped manifest Agent when execution requires it to be runnable", async () => {
    const subject = registry([{ id: ids.researchAgentId, status: "stopped" }]);
    await expect(subject.get(ids.researchAgentId)).rejects.toMatchObject({ code: "AGENT_NOT_RUNNABLE" } satisfies Partial<AgentManifestRegistryError>);
  });

  it("does not make an unregistered real Starter Kit Agent eligible", async () => {
    const subject = registry([{ id: "agt-unregistered", status: "ready" }]);
    await expect(subject.get("agt-unregistered")).resolves.toBeNull();
    await expect(subject.findEligible({ capability: "financial_analysis" })).resolves.toEqual([]);
  });

  it("never exposes mutable manifest storage", async () => {
    const subject = registry();
    const [manifest] = await subject.findEligible({ capability: "market_research" });
    manifest!.capabilities.push("forged");
    await expect(subject.findEligible({ capability: "forged" })).resolves.toEqual([]);
  });
});
