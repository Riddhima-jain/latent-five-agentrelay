import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approvedEmailAction } from "../adapters/__fixtures__/actions.js";
import { InMemoryExecutionStore } from "../adapters/in-memory-execution-store.js";
import { JsonExecutionStore } from "../adapters/json-execution-store.js";
import { MockActionExecutor } from "../adapters/mock-action-executor.js";
import { MockProtectedEmailService } from "../adapters/mock-protected-email-service.js";
import { RecordingTraceSink } from "../adapters/recording-trace-sink.js";
import type { ExecutionStore } from "./execution-ports.js";
import { ProtectedServiceAuthError } from "./execution-errors.js";
import { StubApprovalVerifier } from "./approval-verifier-fakes.js";
import { ExecutionService } from "./execution-service.js";
import { RecoveryService } from "./recovery-service.js";

/**
 * Day-3 attack suite (plan U9). One place a reviewer can read to see every
 * bypass route fail and the one sanctioned route succeed.
 */

const EXECUTOR_TOKEN = "executor-token-1234567890-abcdefghij";
const now = () => new Date("2026-08-29T12:00:00.000Z");

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function wire(options: {
  serviceToken?: string;
  verifier?: ConstructorParameters<typeof ExecutionService>[0]["verifier"];
  store?: ExecutionStore;
} = {}) {
  const service = new MockProtectedEmailService({
    expectedToken: options.serviceToken ?? EXECUTOR_TOKEN,
    now,
  });
  const sink = new RecordingTraceSink();
  const svc = new ExecutionService({
    verifier: options.verifier ?? new StubApprovalVerifier({ ok: true }),
    store: options.store ?? new InMemoryExecutionStore(now),
    executor: new MockActionExecutor({ token: EXECUTOR_TOKEN, service }),
    recovery: new RecoveryService(),
    sink,
    traceId: "trace-1",
    secrets: [EXECUTOR_TOKEN],
    maxAttempts: 2,
    timeoutMs: 50,
    now,
  });
  return { svc, service, sink };
}

describe("enforcement attacks", () => {
  it("direct service call with no executor path fails", async () => {
    const service = new MockProtectedEmailService({ expectedToken: EXECUTOR_TOKEN, now });
    await expect(
      service.send("", { sessionId: "s", actionId: "a", payload: { recipient: "x", subject: "y", body: "z" } }),
    ).rejects.toBeInstanceOf(ProtectedServiceAuthError);
    expect(service.sentCount).toBe(0);
  });

  it("forged token is rejected", async () => {
    const service = new MockProtectedEmailService({ expectedToken: EXECUTOR_TOKEN, now });
    await expect(
      service.send("forged-token-aaaaaaaaaaaaaaaaaa", {
        sessionId: "s",
        actionId: "a",
        payload: { recipient: "x", subject: "y", body: "z" },
      }),
    ).rejects.toBeInstanceOf(ProtectedServiceAuthError);
  });

  it("missing executor token fails at construction", () => {
    const service = new MockProtectedEmailService({ expectedToken: EXECUTOR_TOKEN });
    expect(() => new MockActionExecutor({ token: "", service })).toThrow();
  });

  it("unapproved action is terminal and does not send", async () => {
    const { svc, service } = wire({ verifier: new StubApprovalVerifier({ ok: false, reason: "NO_APPROVAL" }) });
    const outcome = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    expect(outcome.terminal).toBe(true);
    expect(service.sentCount).toBe(0);
  });

  it("denied action is terminal and does not send", async () => {
    const { svc, service } = wire({ verifier: new StubApprovalVerifier({ ok: false, reason: "APPROVAL_DENIED" }) });
    const outcome = await svc.run(approvedEmailAction(), "REQUIRE_APPROVAL");
    expect(outcome.terminal).toBe(true);
    expect(service.sentCount).toBe(0);
  });

  it("modified approved payload (hash mismatch) does not send", async () => {
    const approved = approvedEmailAction();
    const verifier = new StubApprovalVerifier({ ok: false, reason: "HASH_MISMATCH" });
    const { svc, service } = wire({ verifier });
    const tampered = approvedEmailAction({
      payload: { ...approved.payload, body: "totally different body" },
      payloadHash: approved.payloadHash,
    });
    const outcome = await svc.run(tampered, "REQUIRE_APPROVAL");
    expect(outcome.terminal).toBe(true);
    expect(service.sentCount).toBe(0);
  });

  it("concurrent duplicate requests send exactly once", async () => {
    const { svc, service } = wire();
    await Promise.all([
      svc.run(approvedEmailAction(), "AUTO_EXECUTE"),
      svc.run(approvedEmailAction(), "AUTO_EXECUTE"),
      svc.run(approvedEmailAction(), "AUTO_EXECUTE"),
    ]);
    expect(service.sentCount).toBe(1);
  });

  it("retry after success does not re-send", async () => {
    const { svc, service } = wire();
    await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    expect(service.sentCount).toBe(1);
  });

  it("retry after partial failure sends exactly once", async () => {
    const { svc, service } = wire();
    service.failNextSends(1);
    const outcome = await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    expect(outcome.terminal).toBe(false);
    expect(service.sentCount).toBe(1);
  });

  it("a token-like string in the action never reaches a trace event", async () => {
    const { svc, sink } = wire();
    await svc.run(
      approvedEmailAction({ rationale: `secret ${EXECUTOR_TOKEN} do not log` }),
      "AUTO_EXECUTE",
    );
    expect(JSON.stringify(sink.events)).not.toContain(EXECUTOR_TOKEN);
  });

  it("terminal failure surfaces terminal:true for the Coordinator", async () => {
    const { svc } = wire({ serviceToken: "a-different-expected-token-value-000" });
    const outcome = await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    expect(outcome.terminal).toBe(true);
  });

  it("the execution ledger on disk holds no payload fields (R13)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "attacks-ledger-"));
    dirs.push(dir);
    const file = path.join(dir, "executions.json");
    const store = new JsonExecutionStore(file, now);
    await store.initialize();
    const { svc } = wire({ store });
    await svc.run(approvedEmailAction(), "AUTO_EXECUTE");
    const onDisk = await readFile(file, "utf8");
    for (const needle of ["customer@example.com", "We want you back", "win you back", EXECUTOR_TOKEN]) {
      expect(onDisk).not.toContain(needle);
    }
  });
});
