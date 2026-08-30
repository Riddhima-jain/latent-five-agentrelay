import type { AgentManifest } from "./capability.js";
import type { WorkflowTaskDefinition } from "./task.js";

/**
 * The fixed P0 sales-recovery workflow used in tests and the team demo.
 * It intentionally has two independent roots so a scheduler can run them in parallel.
 */
export const SALES_RECOVERY_TASKS: WorkflowTaskDefinition[] = [
  {
    id: "research",
    title: "Market Research",
    requiredCapability: "market_research",
    requiredPermissions: ["read"],
    dependsOn: [],
    maxAttempts: 2,
  },
  {
    id: "finance",
    title: "Financial Analysis",
    requiredCapability: "financial_analysis",
    requiredPermissions: ["read"],
    dependsOn: [],
    maxAttempts: 2,
  },
  {
    id: "strategy",
    title: "Strategy",
    requiredCapability: "strategy",
    requiredPermissions: ["read"],
    dependsOn: ["research", "finance"],
    maxAttempts: 2,
  },
  {
    id: "outreach",
    title: "Outreach",
    requiredCapability: "external_communication",
    requiredPermissions: ["external_write"],
    dependsOn: ["strategy"],
    maxAttempts: 2,
  },
];

/** Deterministic fixture registry; routing chooses the first eligible manifest. */
export const SALES_RECOVERY_AGENTS: AgentManifest[] = [
  {
    agentId: "research-agent",
    name: "Research Agent",
    capabilities: ["market_research"],
    permissions: ["read"],
    runnable: true,
    toolPolicy: { allowedTools: ["resource.read"], resourceScopes: [{ pattern: "market/*", permissions: ["read"] }] },
  },
  {
    agentId: "finance-agent",
    name: "Finance Agent",
    capabilities: ["financial_analysis"],
    permissions: ["read"],
    runnable: true,
    toolPolicy: { allowedTools: ["resource.read"], resourceScopes: [{ pattern: "finance/*", permissions: ["read"] }] },
  },
  {
    agentId: "strategy-agent",
    name: "Strategy Agent",
    capabilities: ["strategy"],
    permissions: ["read"],
    runnable: true,
    toolPolicy: { allowedTools: [], resourceScopes: [] },
  },
  {
    agentId: "outreach-agent",
    name: "Outreach Agent",
    capabilities: ["external_communication"],
    permissions: ["read", "external_write"],
    runnable: true,
    toolPolicy: { allowedTools: ["resource.read"], resourceScopes: [{ pattern: "customer/*", permissions: ["read"] }] },
  },
];
