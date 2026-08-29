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

function harness(overrides: Partial<Parameters<typeof buildDeps>[0]> = {}) {
  return buildDeps(overrides);
}

function buildDeps(overrides: {
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
  it("AUTO_EXECUTE runs without an approval lookup and sends once", async () => {
    const verifier = new CountingVerifier();
    const { svc, service, sink } = harness({ verifier });
    const outcome = await svc.run(approvedEmailAction(), "AUTO_EXECUTE");

    expect(outcome).toEqual({ result: { status: "succeeded", externalReference: "msg-1" }, terminal: false });
    expect(verifier.calls).toBe(0);
    expect(service.sentCount).toBe(1);
    expect(sink.typesEmitted()).toContain("action.executed");
  });

  it("REQUIRE_APPROVAL with a satisfied approval sends once", async () => {
    const { svc, service } = harness({ verifier: new AlwaysApprovedVerifier() });
    const outcome = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    expect(outcome.terminal).toBe(false);
    expect(service.sentCount).toBe(1);
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
    const first = await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    const second = await svc.run(approvedEmailAction(), "AUTO_EXECUTE");

    expect(second).toEqual(first);
    expect(service.sentCount).toBe(1);
    expect(sink.typesEmitted().filter((t) => t === "action.executed")).toHaveLength(1);
  });

  it("concurrent duplicates send exactly once; the loser gets an in-progress outcome", async () => {
    const { svc, service } = harness();
    const [a, b] = await Promise.all([
      svc.run(approvedEmailAction(), "AUTO_EXECUTE"),
      svc.run(approvedEmailAction(), "AUTO_EXECUTE"),
    ]);
    expect(service.sentCount).toBe(1);
    expect(a.terminal).toBe(false);
    expect(b.terminal).toBe(false);
    const statuses = [a.result.status, b.result.status].sort();
    expect(statuses).toContain("succeeded");
  });

  it("a call against a failed record returns the stored terminal outcome, no retry", async () => {
    const service = new MockProtectedEmailService({ expectedToken: "wrong-expected-token-000000000", now });
    const { svc } = harness({ service });
    const first = await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    expect(first.terminal).toBe(true);
    const second = await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    expect(second.terminal).toBe(true);
    expect(service.sentCount).toBe(0);
  });

  it("redacts the token and the raw body from every emitted event", async () => {
    const { svc, sink } = harness();
    await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    const dump = JSON.stringify(sink.events);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain("Here is a discount to win you back.");
    expect(dump).toContain("payloadSummary");
  });

  it("rejects an action whose idempotencyKey does not match its fields", async () => {
    const { svc, service } = harness();
    const outcome = await svc.run(
      approvedEmailAction({ idempotencyKey: "tampered-key" }),
      "AUTO_EXECUTE",
    );
    expect(outcome.terminal).toBe(true);
    expect(service.sentCount).toBe(0);
  });
});
