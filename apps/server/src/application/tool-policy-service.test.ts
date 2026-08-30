import { describe, expect, it } from "vitest";
import type { AccessGrant, ToolAccessRequest } from "../domain/tool-access.js";
import { DeterministicToolPolicyService, normalizeLogicalResource, scopeMatches } from "./tool-policy-service.js";

const grant: AccessGrant = {
  id: "grant-1", sessionId: "session-1", taskId: "research", agentId: "agt-research",
  allowedTools: ["resource.read"], resourceScopes: [{ pattern: "market/*", permissions: ["read"] }], status: "active", createdAt: "2026-08-30T00:00:00.000Z",
};
const request = (resource: string, overrides: Partial<ToolAccessRequest> = {}): ToolAccessRequest => ({
  requestId: "request-1", grantId: "grant-1", tool: "resource.read", resource, operation: "read", timestamp: "2026-08-30T00:00:00.000Z", ...overrides,
});

describe("DeterministicToolPolicyService", () => {
  const service = new DeterministicToolPolicyService(() => "2026-08-30T00:00:00.000Z");

  it("allows an in-scope resource.read request", () => {
    expect(service.evaluate(grant, request("market/market-report.json"))).toEqual({ decision: "ALLOW", reason: "GRANT_PERMITS_REQUEST" });
  });

  it("denies wrong namespace, tool, operation, invalid grant, revoked and expired grants", () => {
    expect(service.evaluate(grant, request("finance/finance-report.csv"))).toEqual({ decision: "DENY", reason: "RESOURCE_OUT_OF_SCOPE" });
    expect(service.evaluate({ ...grant, allowedTools: [] }, request("market/a.json"))).toEqual({ decision: "DENY", reason: "TOOL_NOT_ALLOWED" });
    expect(service.evaluate({ ...grant, resourceScopes: [{ pattern: "market/*", permissions: [] }] }, request("market/a.json"))).toEqual({ decision: "DENY", reason: "OPERATION_NOT_ALLOWED" });
    expect(service.evaluate(grant, request("market/a.json", { grantId: "forged" }))).toEqual({ decision: "DENY", reason: "INVALID_GRANT" });
    expect(service.evaluate({ ...grant, status: "revoked" }, request("market/a.json"))).toEqual({ decision: "DENY", reason: "GRANT_REVOKED" });
    expect(service.evaluate({ ...grant, expiresAt: "2026-08-29T00:00:00.000Z" }, request("market/a.json"))).toEqual({ decision: "DENY", reason: "GRANT_EXPIRED" });
  });

  it("matches exact and prefix scopes only", () => {
    expect(scopeMatches("market/*", "market/a.json")).toBe(true);
    expect(scopeMatches("market/*", "finance/a.csv")).toBe(false);
    expect(scopeMatches("market/market-report.json", "market/market-report.json")).toBe(true);
    expect(scopeMatches("market/market-report.json", "market/other.json")).toBe(false);
  });

  it("rejects traversal, absolute paths, encoded traversal, and null bytes", () => {
    for (const resource of ["../finance/report.csv", "/finance/report.csv", "C:/finance/report.csv", "market/%2e%2e/finance.csv", "market/%252e%252e/finance.csv", "market/a\0.json"]) {
      expect(() => normalizeLogicalResource(resource)).toThrow("Invalid");
    }
  });
});
