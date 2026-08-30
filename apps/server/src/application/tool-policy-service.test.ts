import { describe, expect, it } from "vitest";
import type { AccessGrant } from "../domain/tool-access.js";
import { ToolPolicyService } from "./tool-policy-service.js";

const grant: AccessGrant = { id: "opaque", sessionId: "s", taskId: "research", agentId: "research-agent", allowedTools: ["resource.read"], resourceScopes: [{ pattern: "market/*", permissions: ["read"] }], status: "active", createdAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z" };
const request = (resource: string) => ({ requestId: "r", grantId: "opaque", tool: "resource.read" as const, resource, operation: "read" as const, timestamp: "2026-08-30T00:00:00.000Z" });

describe("ToolPolicyService", () => {
  const policy = new ToolPolicyService(() => Date.parse("2026-08-30T01:00:00.000Z"));
  it("allows only resources inside the grant scope", () => {
    expect(policy.evaluate(grant, request("market/report.json"))).toEqual({ decision: "ALLOW", reason: "GRANT_PERMITS_REQUEST" });
    expect(policy.evaluate(grant, request("finance/report.csv"))).toEqual({ decision: "DENY", reason: "RESOURCE_OUT_OF_SCOPE" });
  });
  it.each(["../secret", "/etc/passwd", "%2e%2e/secret", "market/%2e%2e/finance/report.csv", "market\\report.json", "market/%00report"])("rejects unsafe logical resource %s", (resource) => {
    expect(policy.evaluate(grant, request(resource))).toEqual({ decision: "DENY", reason: "RESOURCE_OUT_OF_SCOPE" });
  });
  it("fails closed for invalid, revoked, and expired grants", () => {
    expect(policy.evaluate(null, request("market/report.json"))).toEqual({ decision: "DENY", reason: "INVALID_GRANT" });
    expect(policy.evaluate({ ...grant, status: "revoked" }, request("market/report.json"))).toEqual({ decision: "DENY", reason: "GRANT_REVOKED" });
    expect(policy.evaluate({ ...grant, expiresAt: "2026-08-29T00:00:00.000Z" }, request("market/report.json"))).toEqual({ decision: "DENY", reason: "GRANT_EXPIRED" });
  });
});
