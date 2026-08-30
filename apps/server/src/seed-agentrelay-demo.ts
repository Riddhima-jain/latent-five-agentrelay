import path from "node:path";
import { AgentService } from "./agent-service.js";
import { provisionDemoAgents } from "./application/demo-agent-provisioner.js";
import { loadConfig } from "./config.js";
import { JsonStore } from "./store.js";
import type { AgentRunner } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

const config = loadConfig();
const unavailableRunner: AgentRunner = { async run() { throw new Error("Seed command does not execute Agents"); }, async cancel() { return false; }, async isAvailable() { return false; } };
const service = new AgentService(config, new JsonStore(path.join(config.dataDirectory, "launchpad.json")), new WorkspaceManager(config.workspaceRoot), unavailableRunner);
await service.initialize();
const result = await provisionDemoAgents(service);
process.stdout.write(`${JSON.stringify(result.ids, null, 2)}\n`);
