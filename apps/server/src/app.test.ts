import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentService } from "./agent-service.js";
import type { ResourceGatewayService } from "./application/resource-gateway-service.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

describe("HTTP boundary", () => {
  it("authorizes the resource route with only its opaque grant and never caller identity", async () => {
    const gateway = { readResource: async (input: { grantId: string; resource: string }) => {
      expect(input).toEqual({ grantId: "g".repeat(32), resource: "market/market-report.json" });
      return { content: "protected", contentType: "text/plain", sourceRef: "resource://market/market-report.json" };
    } } as unknown as ResourceGatewayService;
    const app = await createApp(loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-test-token" }), service, undefined, gateway);
    const response = await app.inject({ method: "GET", url: "/api/middleware/resources/market/market-report.json", headers: { "x-agentrelay-grant": "g".repeat(32), "x-agent-id": "forged-finance-agent" } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("protected");
    await app.close();
  });
  it("protects API routes with the configured shared token", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-test-token" }),
      service,
    );
    const denied = await app.inject({ method: "GET", url: "/api/agents" });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { authorization: "Bearer a-strong-test-token" },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("preserves Fastify client error status codes", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: "{not-json",
    });
    expect(malformed.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(1_100_000) }),
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("returns the Relay session and accepts one payload-bound approval", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const initial = await app.inject({ method: "GET", url: "/api/relay/sessions/demo" });
    expect(initial.statusCode).toBe(200);
    const approvalId = initial.json().session.approval.id as string;

    const approved = await app.inject({
      method: "POST",
      url: `/api/relay/approvals/${approvalId}`,
      payload: { decision: "approve" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().session.status).toBe("completed");
    expect(approved.json().session.approval.status).toBe("approved");

    const replay = await app.inject({
      method: "POST",
      url: `/api/relay/approvals/${approvalId}`,
      payload: { decision: "approve" },
    });
    expect(replay.statusCode).toBe(409);
    await app.close();
  });

  it("rejects unknown Relay resources and injected action contents", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const missing = await app.inject({ method: "GET", url: "/api/relay/sessions/not-found" });
    expect(missing.statusCode).toBe(404);

    const initial = await app.inject({ method: "GET", url: "/api/relay/sessions/demo" });
    const approvalId = initial.json().session.approval.id as string;
    const injected = await app.inject({
      method: "POST",
      url: `/api/relay/approvals/${approvalId}`,
      payload: { decision: "approve", recipient: "attacker@example.com" },
    });
    expect(injected.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/relay/sessions/demo" })).json().session.approval.status).toBe("pending");
    await app.close();
  });

  it("creates fresh Relay sessions with independent approvals", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const first = await app.inject({ method: "POST", url: "/api/relay/sessions" });
    const second = await app.inject({ method: "POST", url: "/api/relay/sessions" });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().session.id).not.toBe(second.json().session.id);
    expect(first.json().session.approval.id).not.toBe(second.json().session.approval.id);

    const approved = await app.inject({
      method: "POST",
      url: `/api/relay/approvals/${first.json().session.approval.id}`,
      payload: { decision: "approve" },
    });
    expect(approved.json().session.status).toBe("completed");
    expect((await app.inject({ method: "GET", url: `/api/relay/sessions/${second.json().session.id}` })).json().session.status).toBe("awaiting_approval");
    await app.close();
  });

  it("lists Relay sessions and rejects unknown scenario controls", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const listed = await app.inject({ method: "GET", url: "/api/relay/sessions" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().sessions.length).toBeGreaterThan(0);

    const resourceAbuse = await app.inject({
      method: "POST",
      url: "/api/relay/sessions",
      payload: { scenario: "resource_abuse" },
    });
    expect(resourceAbuse.statusCode).toBe(201);

    const invalid = await app.inject({ method: "POST", url: "/api/relay/sessions", payload: { scenario: "fake-success" } });
    expect(invalid.statusCode).toBe(400);
    const emptyGoal = await app.inject({ method: "POST", url: "/api/relay/sessions", payload: { goal: "   " } });
    expect(emptyGoal.statusCode).toBe(400);
    await app.close();
  });
});
