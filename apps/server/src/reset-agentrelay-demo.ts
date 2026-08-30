import path from "node:path";
import { RelayJsonStore } from "./application/relay-store.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const store = new RelayJsonStore(path.join(config.dataDirectory, "agentrelay.json"));
await store.initialize();
await store.resetDemo();
process.stdout.write("AgentRelay workflow sessions, approvals, traces, and mock receipts reset. Starter Kit Agents and workspaces were preserved.\n");
