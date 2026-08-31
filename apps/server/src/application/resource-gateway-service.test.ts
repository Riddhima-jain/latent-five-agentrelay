import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentManifest } from "../domain/capability.js";
import { AccessGrantService } from "./access-grant-service.js";
import { FixtureResourceStore } from "./fixture-resource-store.js";
import { RelayJsonStore } from "./relay-store.js";
import { ResourceGatewayService } from "./resource-gateway-service.js";
import { ToolPolicyService } from "./tool-policy-service.js";

const research: AgentManifest = { agentId: "research-real-id", name: "Research Agent", capabilities: ["market_research"], permissions: ["read"], runnable: true, toolPolicy: { allowedTools: ["resource.read"], resourceScopes: [{ pattern: "market/*", permissions: ["read"] }] } };

describe("ResourceGatewayService", () => {
  it("allows Market, denies Finance, and never persists the opaque grant", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentrelay-gateway-"));
    const store = new RelayJsonStore(path.join(root, "relay.json"));
    await store.initialize();
    await store.save({ id: "session", goal: "test", traceId: "trace-session", participantAgentIds: [research.agentId], status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const grants = new AccessGrantService(() => new Date("2026-08-30T00:00:00.000Z"), () => "opaque-secret-grant-token-1234567890");
    const grant = await grants.issueGrant({ sessionId: "session", taskId: "research", agent: research });
    const gateway = new ResourceGatewayService(grants, new ToolPolicyService(() => Date.parse("2026-08-30T00:01:00.000Z")), new FixtureResourceStore(path.resolve("../../fixtures/sales-recovery/protected")), store, async () => "trace-session");
    await expect(gateway.readResource({ grantId: grant.id, resource: "market/market-report.json" })).resolves.toMatchObject({ contentType: "application/json", sourceRef: "resource://market/market-report.json" });
    await expect(gateway.readResource({ grantId: grant.id, resource: "finance/finance-report.csv" })).rejects.toMatchObject({ statusCode: 403, message: "RESOURCE_ACCESS_DENIED: RESOURCE_OUT_OF_SCOPE" });
    await expect(gateway.listAuthorizedSourceRefs({ sessionId: "session", taskId: "research", agentId: research.agentId })).resolves.toEqual(["resource://market/market-report.json"]);
    const serializedTrace = JSON.stringify(await store.listTrace("session"));
    expect(serializedTrace).toContain("tool.access.allowed");
    expect(serializedTrace).toContain("tool.access.denied");
    expect(serializedTrace).not.toContain(grant.id);
  });
});
