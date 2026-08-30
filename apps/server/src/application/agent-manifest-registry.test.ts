import { describe, expect, it } from "vitest";
import type { Agent } from "../types.js";
import { AgentManifestRegistry } from "./agent-manifest-registry.js";

const agent = (id: string, status: Agent["status"] = "ready"): Agent => ({ id, name: id, description: "", instructions: "", status, workspacePath: `/tmp/${id}`, codexThreadId: null, lastError: null, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" });

describe("AgentManifestRegistry", () => {
  it("routes only registered, real, runnable Agents", async () => {
    const agents = [agent("real-research"), agent("unregistered"), agent("stopped-finance", "stopped")];
    const service = { listAgents: () => agents, getAgent: (id: string) => { const value = agents.find((item) => item.id === id); if (!value) throw new Error("not found"); return value; } };
    const registry = new AgentManifestRegistry(service as never, [
      { agentId: "real-research", name: "Research", capabilities: ["market_research"], permissions: ["read"], runnable: true },
      { agentId: "stopped-finance", name: "Finance", capabilities: ["financial_analysis"], permissions: ["read"], runnable: true },
    ]);
    expect((await registry.findEligible({ capability: "market_research", requiredPermissions: ["read"] })).map((item) => item.agentId)).toEqual(["real-research"]);
    expect(await registry.findEligible({ capability: "financial_analysis" })).toEqual([]);
    expect(await registry.get("unregistered")).toBeNull();
    await expect(registry.requireRunnable("stopped-finance")).rejects.toMatchObject({ statusCode: 409 });
    await expect(new AgentManifestRegistry(service as never, [{ agentId: "missing", name: "Missing", capabilities: ["x"], permissions: [], runnable: true }]).list()).rejects.toMatchObject({ statusCode: 409 });
  });
});
