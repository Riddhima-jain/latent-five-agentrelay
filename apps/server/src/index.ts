import path from "node:path";
import { AgentService } from "./agent-service.js";
import { createApp } from "./app.js";
import { isModelConfigured, loadConfig, writeCodexConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";
import { JsonStore } from "./store.js";
import { WorkspaceManager } from "./workspace.js";
import { RelayJsonStore } from "./application/relay-store.js";
import { createEmailExecutor } from "./application/email-executor.js";
import { RelayWorkflowService } from "./application/relay-workflow-service.js";
import { InMemoryAccessGrantService } from "./application/access-grant-service.js";
import { FixtureResourceStore } from "./application/fixture-resource-store.js";
import { ProtectedResourceGatewayService, type ResourceAccessAuditSink } from "./application/resource-gateway-service.js";
import { DeterministicToolPolicyService } from "./application/tool-policy-service.js";
import { randomUUID } from "node:crypto";

const config = loadConfig();
await writeCodexConfig(config);

const store = new JsonStore(path.join(config.dataDirectory, "launchpad.json"));
const workspaces = new WorkspaceManager(config.workspaceRoot);
const runner = createRunner(config);
const service = new AgentService(config, store, workspaces, runner);
await service.initialize();

const relayStore = new RelayJsonStore(path.join(config.dataDirectory, "agentrelay.json"));
const accessGrants = new InMemoryAccessGrantService();
const resourceAudit: ResourceAccessAuditSink = {
  async record(event) {
    if (!event.sessionId) return;
    await relayStore.append({
      id: `resource:${randomUUID()}`,
      traceId: `trace-${event.sessionId}`,
      sessionId: event.sessionId,
      type: event.type,
      timestamp: new Date().toISOString(),
      ...(event.taskId ? { taskId: event.taskId } : {}),
      ...(event.agentId ? { agentId: event.agentId } : {}),
      metadata: { tool: "resource.read", resource: event.resource, operation: "read", ...(event.decision ? { decision: event.decision } : {}), ...(event.reason ? { reason: event.reason } : {}) },
    });
  },
};
const resourceGateway = new ProtectedResourceGatewayService(
  accessGrants,
  new DeterministicToolPolicyService(),
  new FixtureResourceStore(path.resolve("fixtures/sales-recovery/protected")),
  undefined,
  resourceAudit,
);
const emailExecutor = createEmailExecutor({
  provider: config.emailExecutor,
  resendApiKey: config.resendApiKey,
  resendFrom: config.resendFrom,
  resendToOverride: config.resendToOverride,
}, relayStore);
const relayService = new RelayWorkflowService(
  relayStore,
  runner,
  emailExecutor,
  config.workspaceRoot,
  path.resolve("fixtures/sales-recovery"),
  undefined,
  undefined,
  async () => isModelConfigured(config) && await runner.isAvailable(),
  accessGrants,
);
await relayService.initialize();

const app = await createApp(config, service, relayService, resourceGateway);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
