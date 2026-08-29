import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ApprovedAction } from "../domain/action.js";
import { payloadHashFor } from "./approval-service.js";
import { MockEmailExecutor, ResendEmailExecutor, idempotencyKeyFor } from "./email-executor.js";
import { RelayJsonStore } from "./relay-store.js";

async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentrelay-email-"));
  const store = new RelayJsonStore(path.join(root, "relay.json"));
  await store.initialize();
  const proposed = { id: "a1", sessionId: "s1", taskId: "outreach", producerAgentId: "outreach-agent", type: "SEND_EMAIL", target: "test", payload: { recipient: "customer@example.com", subject: "Recovery", body: "Hello" }, createdAt: "2026-01-01T00:00:00Z" };
  const payloadHash = payloadHashFor(proposed);
  return { store, action: { ...proposed, payloadHash, idempotencyKey: idempotencyKeyFor(proposed.id, payloadHash) } satisfies ApprovedAction };
}

describe("email executors", () => {
  it("executes the mock action once for repeated idempotency keys", async () => {
    const { store, action } = await harness();
    const executor = new MockEmailExecutor(store, () => "2026-01-01T00:00:00Z");
    const first = await executor.execute(action);
    const second = await executor.execute(action);
    expect(second.externalReference).toBe(first.externalReference);
    expect(await store.listReceipts("s1")).toHaveLength(1);
  });

  it("rejects an action modified after approval", async () => {
    const { store, action } = await harness();
    const executor = new MockEmailExecutor(store);
    await expect(executor.execute({ ...action, payload: { ...action.payload as object, recipient: "attacker@example.com" } })).rejects.toThrow(/payload hash/);
  });

  it("uses the configured Resend override and idempotency header", async () => {
    const { store, action } = await harness();
    const request = vi.fn(async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200, headers: { "content-type": "application/json" } }));
    const executor = new ResendEmailExecutor(store, { provider: "resend", resendApiKey: "secret-test-key", resendFrom: "AgentRelay <demo@example.com>", resendToOverride: "team@example.com" }, () => "2026-01-01T00:00:00Z", request);
    expect((await executor.execute(action)).externalReference).toBe("email_123");
    const [, options] = request.mock.calls[0]!;
    expect(JSON.parse(String(options?.body)).to).toEqual(["team@example.com"]);
    expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(action.idempotencyKey);
  });
});
