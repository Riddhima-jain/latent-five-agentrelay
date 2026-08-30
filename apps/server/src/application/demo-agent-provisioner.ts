import type { AgentService } from "../agent-service.js";
import type { AgentManifest } from "../domain/capability.js";

const definitions = [
  { key: "research", name: "AgentRelay Demo — Research", capability: "market_research", permissions: ["read"] as const, scopes: ["market/*"], instructions: "You are the Market Research Agent. Use only resources explicitly granted through the current AgentRelay Context Capsule. Support claims with exact sourceRefs. Return structured summary, evidence, and proposedActions. Never assign risk, permissions, approval, or automation decisions." },
  { key: "finance", name: "AgentRelay Demo — Finance", capability: "financial_analysis", permissions: ["read"] as const, scopes: ["finance/*"], instructions: "You are the Finance Agent. Analyze financial and unit-economics information from the current AgentRelay Context Capsule. Use only explicitly granted resources and exact sourceRefs. Return structured summary, evidence, and proposedActions. Never decide whether downstream actions are safe." },
  { key: "strategy", name: "AgentRelay Demo — Strategy", capability: "strategy", permissions: ["read"] as const, scopes: [], instructions: "You are the Strategy Agent. Synthesize accepted Evidence Records from declared dependencies, identify agreement and conflict, and recommend a strategy. Return structured summary, evidence, and proposedActions. Never classify your own action as safe or decide whether it executes." },
  { key: "outreach", name: "AgentRelay Demo — Outreach", capability: "external_communication", permissions: ["read", "external_write"] as const, scopes: ["customer/*"], instructions: "You are the Outreach Agent. Prepare customer-facing communication from approved workflow context. Represent communication as a structured SEND_EMAIL proposedAction. Never claim it was sent or bypass AgentRelay policy, approval, or execution." },
] as const;

export async function provisionDemoAgents(service: AgentService): Promise<{ manifests: AgentManifest[]; ids: Record<string, string> }> {
  const manifests: AgentManifest[] = [];
  const ids: Record<string, string> = {};
  for (const definition of definitions) {
    let agent = service.listAgents().find((candidate) => candidate.name === definition.name);
    if (!agent) agent = await service.createAgent({ name: definition.name, description: `AgentRelay ${definition.capability} specialist`, instructions: definition.instructions });
    else if (agent.instructions !== definition.instructions || agent.description !== `AgentRelay ${definition.capability} specialist`) agent = await service.updateAgent(agent.id, { description: `AgentRelay ${definition.capability} specialist`, instructions: definition.instructions });
    if (agent.status === "stopped" || agent.status === "error") agent = await service.startAgent(agent.id);
    ids[definition.key] = agent.id;
    manifests.push({ agentId: agent.id, name: definition.name.replace("AgentRelay Demo — ", "") + " Agent", capabilities: [definition.capability], permissions: [...definition.permissions], runnable: agent.status === "ready", toolPolicy: { allowedTools: definition.scopes.length ? ["resource.read"] : [], resourceScopes: definition.scopes.map((pattern) => ({ pattern, permissions: ["read"] })) } });
  }
  return { manifests, ids };
}
