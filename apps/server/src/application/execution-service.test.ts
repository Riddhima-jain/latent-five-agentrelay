import { describe, expect, it } from "vitest";
import { approvedEmailAction } from "../adapters/__fixtures__/actions.js";
import { InMemoryExecutionStore } from "../adapters/in-memory-execution-store.js";
import { MockActionExecutor } from "../adapters/mock-action-executor.js";
import { MockProtectedEmailService } from "../adapters/mock-protected-email-service.js";
import { RecordingTraceSink } from "../adapters/recording-trace-sink.js";
import {
  AlwaysApprovedVerifier,
  StubApprovalVerifier,
} from "./approval-verifier-fakes.js";
import { ExecutionService } from "./execution-service.js";
import { RecoveryService } from "./recovery-service.js";

const TOKEN = "executor-token-1234567890-abcdefghij";
const now = () => new Date("2026-08-29T12:00:00.000Z");

class CountingVerifier {
  calls = 0;
  async isSatisfied() {
    this.calls += 1;
    return { ok: true } as const;
  }
}

function harness(overrides: {
  verifier?: ConstructorParameters<typeof ExecutionService>[0]["verifier"];
  service?: MockProtectedEmailService;
} = {}) {
  const service = overrides.service ?? new MockProtectedEmailService({ expectedToken: TOKEN, now });
  const store = new InMemoryExecutionStore(now);
  const sink = new RecordingTraceSink();
  const svc = new ExecutionService({
    verifier: overrides.verifier ?? new AlwaysApprovedVerifier(),
    store,
    executor: new MockActionExecutor({ token: TOKEN, service }),
    recovery: new RecoveryService(),
    sink,
    traceId: "trace-1",
    secrets: [TOKEN],
    maxAttempts: 2,
    timeoutMs: 50,
    now,
  });
  return { svc, service, store, sink };
}

describe("ExecutionService", () => {
  it("refuses AUTO_EXECUTE for a protected action before any approval lookup or send", async () => {
    const verifier = new CountingVerifier();
    const { svc, service, sink } = harness({ verifier });
    const outcome = await svc.run(approvedEmailAction(), "AUTO_EXECUTE");

    expect(outcome).toMatchObject({ terminal: true, reason: "PROTECTED_ACTION_REQUIRES_APPROVAL" });
    expect(verifier.calls).toBe(0);
    expect(service.sentCount).toBe(0);
    expect(sink.events.find((e) => e.type === "action.failed")?.metadata).toMatchObject({
      reason: "PROTECTED_ACTION_REQUIRES_APPROVAL",
    });
  });

  it("REQUIRE_APPROVAL consults the verifier and, when satisfied, sends once", async () => {
    const verifier = new CountingVerifier();
    const { svc, service, sink } = harness({ verifier });
    const outcome = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");

    expect(outcome).toEqual({
      result: { status: "succeeded", externalReference: "msg-1" },
      terminal: false,
      reason: undefined,
    });
    expect(verifier.calls).toBe(1);
    expect(service.sentCount).toBe(1);
    expect(sink.typesEmitted()).toContain("action.executed");
  });

  it("REQUIRE_APPROVAL denied: terminal, no send, action.failed with the reason", async () => {
    const verifier = new StubApprovalVerifier({ ok: false, reason: "APPROVAL_DENIED" });
    const { svc, service, sink, store } = harness({ verifier });
    const outcome = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");

    expect(outcome).toMatchObject({ terminal: true, reason: "APPROVAL_DENIED" });
    expect(service.sentCount).toBe(0);
    const failed = sink.events.find((e) => e.type === "action.failed");
    expect(failed?.metadata).toMatchObject({ reason: "APPROVAL_DENIED" });
    expect(await store.get("session-1|action-1|" + approvedEmailAction().payloadHash)).toBeNull();
  });

  it("hash mismatch is terminal, does not send, and records no claim", async () => {
    const verifier = new StubApprovalVerifier({ ok: false, reason: "HASH_MISMATCH" });
    const { svc, service, sink } = harness({ verifier });
    const outcome = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    expect(outcome).toMatchObject({ terminal: true, reason: "HASH_MISMATCH" });
    expect(service.sentCount).toBe(0);
    expect(sink.events.find((e) => e.type === "action.failed")?.metadata).toMatchObject({
      reason: "HASH_MISMATCH",
    });
  });

  it("DENY and RECOMMEND_ONLY are caller-contract violations", async () => {
    const { svc } = harness();
    await expect(svc.run(approvedEmailAction(), "DENY")).rejects.toThrow();
    await expect(svc.run(approvedEmailAction(), "RECOMMEND_ONLY")).rejects.toThrow();
  });

  it("a duplicate call after success returns the stored outcome and does not re-send", async () => {
    const { svc, service, sink } = harness();
    const first = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    const second = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");

    expect(second).toEqual(first);
    expect(service.sentCount).toBe(1);
    expect(sink.typesEmitted().filter((t) => t === "action.executed")).toHaveLength(1);
  });

  it("concurrent duplicates send exactly once; the loser gets an in-progress outcome", async () => {
    const { svc, service } = harness();
    const [a, b] = await Promise.all([
      svc.run(approvedEmailAction(), "REQUIRE_APPROVAL"),
      svc.run(approvedEmailAction(), "REQUIRE_APPROVAL"),
    ]);
    expect(service.sentCount).toBe(1);
    expect(a.terminal).toBe(false);
    expect(b.terminal).toBe(false);
    const statuses = [a.result.status, b.result.status].sort();
    expect(statuses).toContain("succeeded");
  });

  it("a seeded executing record makes a fresh call return in-progress without sending", async () => {
    const { svc, service, store } = harness();
    const key = "session-1|action-1|" + approvedEmailAction().payloadHash;
    await store.claim({ idempotencyKey: key, sessionId: "session-1", actionId: "action-1", payloadHash: approvedEmailAction().payloadHash });
    const outcome = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    expect(outcome).toEqual({ result: { status: "executing" }, terminal: false });
    expect(service.sentCount).toBe(0);
  });

  it("a call against a failed record returns the stored terminal outcome, no retry", async () => {
    const service = new MockProtectedEmailService({ expectedToken: "wrong-expected-token-000000000", now });
    const { svc } = harness({ service });
    const first = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    expect(first.terminal).toBe(true);
    const second = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    expect(second.terminal).toBe(true);
    expect(service.sentCount).toBe(0);
  });

  it("redacts a secret carried in an actually-emitted field (target) and the raw body", async () => {
    const { svc, sink } = harness();
    const action = approvedEmailAction({ target: `customer@example.com ${TOKEN}` });
    await svc.run(action, "REQUIRE_APPROVAL");

    const dump = JSON.stringify(sink.events);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain("Here is a discount to win you back.");
    for (const event of sink.events) {
      expect(event.metadata?.target).toBe("[REDACTED]");
    }
    expect(dump).toContain("payloadSummary");
  });

  it("redacts a secret embedded in a failure reason before it is persisted or traced", async () => {
    const { svc, service, store, sink } = harness();
    service.failNextSendWith(new Error(`upstream said ${TOKEN} is bad`));
    service.failNextSendWith(new Error(`upstream said ${TOKEN} is bad`));
    const action = approvedEmailAction();
    const outcome = await svc.run(action, "REQUIRE_APPROVAL");

    expect(outcome.terminal).toBe(true);
    const record = await store.get("session-1|action-1|" + action.payloadHash);
    expect(JSON.stringify(record)).not.toContain(TOKEN);
    expect(JSON.stringify(sink.events)).not.toContain(TOKEN);
  });

  it("rejects an action whose idempotencyKey does not match its fields", async () => {
    const { svc, service } = harness();
    const outcome = await svc.run(
      approvedEmailAction({ idempotencyKey: "tampered-key" }),
      "REQUIRE_APPROVAL",
    );
    expect(outcome).toMatchObject({ terminal: true, reason: "IDEMPOTENCY_KEY_MISMATCH" });
    expect(service.sentCount).toBe(0);
  });

  it("a trace-sink failure does not abort the execution state machine", async () => {
    const failingSink = { append: async () => { throw new Error("sink down"); } };
    const service = new MockProtectedEmailService({ expectedToken: TOKEN, now });
    const store = new InMemoryExecutionStore(now);
    const svc = new ExecutionService({
      verifier: new AlwaysApprovedVerifier(),
      store,
      executor: new MockActionExecutor({ token: TOKEN, service }),
      recovery: new RecoveryService(),
      sink: failingSink,
      traceId: "trace-1",
      secrets: [TOKEN],
      maxAttempts: 2,
      timeoutMs: 50,
      now,
    });
    const outcome = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    expect(outcome.terminal).toBe(false);
    expect(service.sentCount).toBe(1);
    const record = await store.get("session-1|action-1|" + approvedEmailAction().payloadHash);
    expect(record?.status).toBe("succeeded");
  });
});
