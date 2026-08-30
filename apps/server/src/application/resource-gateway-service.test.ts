import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoAgentManifests } from "./agent-manifest-bootstrap.js";
import { InMemoryAccessGrantService } from "./access-grant-service.js";
import { FixtureResourceStore } from "./fixture-resource-store.js";
import { ProtectedResourceGatewayService, ResourceAccessError } from "./resource-gateway-service.js";
import { DeterministicToolPolicyService } from "./tool-policy-service.js";

const manifests = createDemoAgentManifests({
  researchAgentId: "agt-research", financeAgentId: "agt-finance", strategyAgentId: "agt-strategy", outreachAgentId: "agt-outreach",
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/sales-recovery/protected");

async function harness() {
  const grants = new InMemoryAccessGrantService(() => "2026-08-30T00:00:00.000Z", (() => { let id = 0; return () => `grant-${++id}`; })());
  const gateway = new ProtectedResourceGatewayService(grants, new DeterministicToolPolicyService(), new FixtureResourceStore(root));
  return { grants, gateway };
}

describe("ProtectedResourceGatewayService", () => {
  it("allows Research market and Finance finance reads through immutable grants", async () => {
    const { grants, gateway } = await harness();
    const research = await grants.issueGrant({ sessionId: "s1", taskId: "research", agent: manifests[0]! });
    const finance = await grants.issueGrant({ sessionId: "s1", taskId: "finance", agent: manifests[1]! });
    await expect(gateway.readResource({ grantId: research.id, resource: "market/market-report.json" })).resolves.toMatchObject({ resource: "market/market-report.json", contentType: "application/json", content: expect.stringContaining("Orbit") });
    await expect(gateway.readResource({ grantId: finance.id, resource: "finance/finance-report.csv" })).resolves.toMatchObject({ contentType: "text/csv", content: expect.stringContaining("current_margin_pct") });
  });

  it("denies Research access to Finance content without returning it", async () => {
    const { grants, gateway } = await harness();
    const research = await grants.issueGrant({ sessionId: "s1", taskId: "research", agent: manifests[0]! });
    await expect(gateway.readResource({ grantId: research.id, resource: "finance/finance-report.csv" })).rejects.toMatchObject({ name: "ResourceAccessError", reason: "RESOURCE_OUT_OF_SCOPE" } satisfies Partial<ResourceAccessError>);
  });

  it("denies invalid grants, traversal, revocation, and a forged caller identity", async () => {
    const { grants, gateway } = await harness();
    const research = await grants.issueGrant({ sessionId: "s1", taskId: "research", agent: manifests[0]! });
    await expect(gateway.readResource({ grantId: "forged", resource: "market/market-report.json" })).rejects.toMatchObject({ reason: "INVALID_GRANT" } satisfies Partial<ResourceAccessError>);
    await expect(gateway.readResource({ grantId: research.id, resource: "market/%2e%2e/finance/finance-report.csv" })).rejects.toMatchObject({ reason: "RESOURCE_OUT_OF_SCOPE" } satisfies Partial<ResourceAccessError>);
    await grants.revokeGrant(research.id);
    await expect(gateway.readResource({ grantId: research.id, resource: "market/market-report.json" })).rejects.toMatchObject({ reason: "GRANT_REVOKED" } satisfies Partial<ResourceAccessError>);
  });

  it("does not let a caller mutate its returned grant to add a Finance scope", async () => {
    const { grants, gateway } = await harness();
    const research = await grants.issueGrant({ sessionId: "s1", taskId: "research", agent: manifests[0]! });
    research.agentId = "agt-finance";
    research.resourceScopes.push({ pattern: "finance/*", permissions: ["read"] });
    await expect(gateway.readResource({ grantId: research.id, resource: "finance/finance-report.csv" })).rejects.toMatchObject({ reason: "RESOURCE_OUT_OF_SCOPE" } satisfies Partial<ResourceAccessError>);
  });
});
