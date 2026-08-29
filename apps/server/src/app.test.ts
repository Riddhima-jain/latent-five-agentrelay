import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentService } from "./agent-service.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

describe("HTTP boundary", () => {
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
});
