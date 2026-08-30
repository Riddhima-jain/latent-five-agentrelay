import path from "node:path";
import { AgentService } from "./agent-service.js";
import { createApp } from "./app.js";
import { isModelConfigured, loadConfig, writeCodexConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";
import { JsonStore } from "./store.js";
import { WorkspaceManager } from "./workspace.js";
import { RelayJsonStore } from "./application/relay-store.js";
import { createEmailExecutor } from "./application/email-executor.js";
import { JsonExecutionStore } from "./adapters/json-execution-store.js";
import { RelayWorkflowService } from "./application/relay-workflow-service.js";

const config = loadConfig();
await writeCodexConfig(config);

const store = new JsonStore(path.join(config.dataDirectory, "launchpad.json"));
const workspaces = new WorkspaceManager(config.workspaceRoot);
const runner = createRunner(config);
const service = new AgentService(config, store, workspaces, runner);
await service.initialize();

const relayStore = new RelayJsonStore(path.join(config.dataDirectory, "agentrelay.json"));
const emailExecutor = createEmailExecutor({
  provider: config.emailExecutor,
  executorToken: config.executorToken,
  resendApiKey: config.resendApiKey,
  resendFrom: config.resendFrom,
  resendToOverride: config.resendToOverride,
}, relayStore);
const executionStore = new JsonExecutionStore(path.join(config.dataDirectory, "agentrelay-executions.json"));
await executionStore.initialize();
const relayService = new RelayWorkflowService(
  relayStore,
  runner,
  emailExecutor,
  config.workspaceRoot,
  path.resolve("fixtures/sales-recovery"),
  undefined,
  undefined,
  async () => isModelConfigured(config) && await runner.isAvailable(),
  executionStore,
  [config.executorToken, config.resendApiKey].filter(Boolean),
);
await relayService.initialize();

const app = await createApp(config, service, relayService);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
