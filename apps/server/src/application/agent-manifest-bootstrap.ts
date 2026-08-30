import type { AgentManifest } from "../domain/capability.js";

/** IDs must come from Person 5's persisted Starter Kit demo-Agent seed. */
export interface DemoAgentIds {
  researchAgentId: string;
  financeAgentId: string;
  strategyAgentId: string;
  outreachAgentId: string;
}

export function createDemoAgentManifests(agentIds: DemoAgentIds): AgentManifest[] {
  return [
    { agentId: agentIds.researchAgentId, name: "Research Agent", capabilities: ["market_research"], permissions: ["read"], runnable: true, toolPolicy: { allowedTools: ["resource.read"], resourceScopes: [{ pattern: "market/*", permissions: ["read"] }] } },
    { agentId: agentIds.financeAgentId, name: "Finance Agent", capabilities: ["financial_analysis"], permissions: ["read"], runnable: true, toolPolicy: { allowedTools: ["resource.read"], resourceScopes: [{ pattern: "finance/*", permissions: ["read"] }] } },
    { agentId: agentIds.strategyAgentId, name: "Strategy Agent", capabilities: ["strategy"], permissions: ["read"], runnable: true, toolPolicy: { allowedTools: [], resourceScopes: [] } },
    { agentId: agentIds.outreachAgentId, name: "Outreach Agent", capabilities: ["external_communication"], permissions: ["read", "external_write"], runnable: true, toolPolicy: { allowedTools: ["resource.read"], resourceScopes: [{ pattern: "customer/*", permissions: ["read"] }] } },
  ];
}
