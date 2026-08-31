import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRunner, RunnerRequest } from "../types.js";
import { InMemoryExecutionStore } from "../adapters/in-memory-execution-store.js";
import { MockActionExecutor } from "../adapters/mock-action-executor.js";
import { MockProtectedEmailService } from "../adapters/mock-protected-email-service.js";
import type { ExternalActionExecutor } from "../domain/ports.js";
import { MockEmailExecutor } from "./email-executor.js";
import { RelayJsonStore } from "./relay-store.js";
import { RelayWorkflowService } from "./relay-workflow-service.js";

class WorkflowRunner implements AgentRunner {
  readonly requests: RunnerRequest[] = [];

  async run(request: RunnerRequest) {
    this.requests.push(request);
    const task = /"id":"([^"]+)"/.exec(request.prompt)?.[1] ?? "unknown";
    const action = task === "outreach" ? [{ type: "SEND_EMAIL", target: "customer@example.com", payload: { recipient: "customer@example.com", subject: "Recovery plan", body: "Hello from AgentRelay" }, rationale: "Approved recovery strategy" }] : [];
    const sourceRef = task === "research"
      ? (request.prompt.includes("competitor-pricing.csv") ? "resource://market/competitor-pricing.csv" : "resource://market/market-report.json")
      : task === "finance"
        ? "resource://finance/finance-report.csv"
        : task === "outreach"
          ? "resource://customer/customer-list.json"
          : (request.prompt.includes("competitor-pricing.csv") ? "resource://market/competitor-pricing.csv" : "resource://market/market-report.json");
    return { output: JSON.stringify({ summary: `${task} completed`, evidence: [{ claim: `${task} evidence`, sourceRefs: [sourceRef] }], proposedActions: action }), threadId: `thread-${task}`, usage: null };
  }
  async cancel() { return true; }
  async isAvailable() { return true; }
}

async function createHarness(executor?: ExternalActionExecutor, secrets: string[] = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentrelay-workflow-"));
  const store = new RelayJsonStore(path.join(root, "relay.json"));
  const executionStore = new InMemoryExecutionStore();
  const runner = new WorkflowRunner();
  const service = new RelayWorkflowService(store, runner, executor ?? new MockEmailExecutor(store), path.join(root, "workspaces"), path.resolve("../../fixtures/sales-recovery"), () => new Date().toISOString(), () => "fixed-session-id", () => Promise.resolve(true), undefined, undefined, undefined, undefined, executionStore, secrets);
  await service.initialize();
  return { root, store, service, executionStore, runner };
}

async function waitFor(service: RelayWorkflowService, id: string, statuses: string[]) {
  // The workflow runs asynchronously and competes with the rest of the suite.
  // Allow enough headroom for parallel Vitest workers on slower machines.
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const session = await service.getSession(id);
    if (statuses.includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Session ${id} did not reach ${statuses.join(", ")}`);
}

describe("RelayWorkflowService", () => {
  it("runs the coordinator, persists evidence, and executes one approved mock email", async () => {
    const { service, store } = await createHarness();
    const created = await service.createSession({ goal: "Investigate the sales decline", scenario: "normal" });
    expect(created.goal).toBe("Investigate the sales decline");
    const pending = await waitFor(service, created.id, ["awaiting_approval"]);
    expect(pending.tasks.every((task) => task.status === "completed" || task.status === "approval_required")).toBe(true);
    expect(pending.evidence?.length).toBeGreaterThanOrEqual(4);
    expect(pending.agentManifests).toHaveLength(4);
    expect(pending.resourceAccessEvents?.map((event) => `${event.agentName}:${event.decision}`)).toEqual(expect.arrayContaining(["Research Agent:ALLOW", "Finance Agent:ALLOW", "Outreach Agent:ALLOW"]));

    const completed = await service.decideApproval(pending.approval!.id, "approve");
    expect(completed.status).toBe("completed");
    expect(completed.receipts).toHaveLength(1);
    expect(await store.listReceipts(created.id)).toHaveLength(1);
    await expect(service.decideApproval(pending.approval!.id, "approve")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("routes the approved action through the enforced ExecutionService boundary", async () => {
    const { service, executionStore } = await createHarness();
    const created = await service.createSession({ scenario: "normal" });
    const pending = await waitFor(service, created.id, ["awaiting_approval"]);
    const completed = await service.decideApproval(pending.approval!.id, "approve");

    const types = completed.trace.map((event) => event.type);
    expect(types).toContain("action.execution_started");
    expect(types).toContain("action.executed");
    expect(types.filter((type) => type === "action.executed")).toHaveLength(1);

    const ledgerKey = `${created.id}|${pending.approval!.actionId}|${pending.approval!.actionHash}`;
    const record = await executionStore.get(ledgerKey);
    expect(record?.status).toBe("succeeded");
  });

  it("keeps the executor credential and the email body out of every persisted trace event and ledger record", async () => {
    const secret = "executor-token-000000000000-abcdef";
    const { service, store, executionStore } = await createHarness(undefined, [secret]);
    const created = await service.createSession({ scenario: "normal" });
    const pending = await waitFor(service, created.id, ["awaiting_approval"]);
    await service.decideApproval(pending.approval!.id, "approve");

    const traceEvents = await store.listTrace(created.id);
    const traceBlob = JSON.stringify(traceEvents);
    // The credential and the email body never reach the trace store; the
    // executor-boundary events carry a redacted target and a length summary only.
    expect(traceBlob).not.toContain(secret);
    expect(traceBlob).not.toContain("Hello from AgentRelay");
    const boundaryEvents = traceEvents.filter((event) => event.type === "action.execution_started" || event.type === "action.executed");
    expect(boundaryEvents.length).toBeGreaterThan(0);
    for (const event of boundaryEvents) {
      expect(event.metadata?.target).toBe("[REDACTED]");
      expect(String(event.metadata?.payloadSummary)).toMatch(/^SEND_EMAIL, \d+ chars$/);
    }

    const ledgerKey = `${created.id}|${pending.approval!.actionId}|${pending.approval!.actionHash}`;
    const ledgerBlob = JSON.stringify(await executionStore.get(ledgerKey));
    expect(ledgerBlob).not.toContain(secret);
    expect(ledgerBlob).not.toContain("Hello from AgentRelay");
    expect(ledgerBlob).not.toContain("customer@example.com");
  });

  it("rejects a re-approval while an execution claim is still open (409, no send)", async () => {
    const seenService = new MockProtectedEmailService({ expectedToken: "harness-executor-token-000000000000" });
    const executor = new MockActionExecutor({ token: "harness-executor-token-000000000000", service: seenService });
    const { service, executionStore } = await createHarness(executor);
    const created = await service.createSession({ scenario: "normal" });
    const pending = await waitFor(service, created.id, ["awaiting_approval"]);
    const ledgerKey = `${created.id}|${pending.approval!.actionId}|${pending.approval!.actionHash}`;
    await executionStore.claim({ idempotencyKey: ledgerKey, sessionId: created.id, actionId: pending.approval!.actionId, payloadHash: pending.approval!.actionHash });

    await expect(service.decideApproval(pending.approval!.id, "approve")).rejects.toMatchObject({ statusCode: 409 });
    expect(seenService.sentCount).toBe(0);
  });

  it("persists an approval-ready session across service restart", async () => {
    const { root, service } = await createHarness();
    const created = await service.createSession();
    await waitFor(service, created.id, ["awaiting_approval"]);

    const restartedStore = new RelayJsonStore(path.join(root, "relay.json"));
    const restarted = new RelayWorkflowService(restartedStore, new WorkflowRunner(), new MockEmailExecutor(restartedStore), path.join(root, "workspaces"), path.resolve("../../fixtures/sales-recovery"));
    await restarted.initialize();
    expect((await restarted.getSession(created.id)).status).toBe("awaiting_approval");
  });

  it("reconciles an approved-but-unfinished session on restart from the receipt ledger", async () => {
    const { root, store, service } = await createHarness();
    const created = await service.createSession();
    const pending = await waitFor(service, created.id, ["awaiting_approval"]);
    // Simulate a crash right after the user approved: the approval is approved,
    // the session status was never advanced past awaiting_approval, no receipt.
    const approval = await store.getApproval(pending.approval!.id);
    await store.saveApproval({ ...approval!, status: "approved", approvedAt: new Date().toISOString() });

    const restarted = new RelayWorkflowService(new RelayJsonStore(path.join(root, "relay.json")), new WorkflowRunner(), new MockEmailExecutor(store), path.join(root, "workspaces"), path.resolve("../../fixtures/sales-recovery"));
    await restarted.initialize();
    expect((await restarted.getSession(created.id)).status).toBe("failed");
  });

  it("records real coordinator retries and failure for the controlled timeout", async () => {
    const { service } = await createHarness();
    const created = await service.createSession({ scenario: "timeout" });
    const failed = await waitFor(service, created.id, ["failed"]);
    expect(failed.trace.filter((event) => event.type === "retry.scheduled")).not.toHaveLength(0);
    expect(failed.tasks.find((task) => task.id === "research")?.status).toBe("failed");
  });

  it("fails the session on a terminal protected-execution failure and keeps it out of completed (U11/U13)", async () => {
    const failingService = new MockProtectedEmailService({ expectedToken: "harness-executor-token-000000000000" });
    failingService.failNextSends(99);
    const failingExecutor = new MockActionExecutor({ token: "harness-executor-token-000000000000", service: failingService });
    const { service, store } = await createHarness(failingExecutor);
    const created = await service.createSession({ scenario: "normal" });
    const pending = await waitFor(service, created.id, ["awaiting_approval"]);

    await expect(service.decideApproval(pending.approval!.id, "approve")).rejects.toMatchObject({ statusCode: 502 });

    const failed = await service.getSession(created.id);
    expect(failed.status).toBe("failed");
    const types = failed.trace.map((event) => event.type);
    expect(types).toContain("action.failed");
    expect(types).toContain("session.failed");
    expect(failingService.sentCount).toBe(0);
    expect(await store.listReceipts(created.id)).toHaveLength(0);
  });

  it("runs the real coordinator output through the prohibited-action policy", async () => {
    const { service } = await createHarness();
    const created = await service.createSession({ scenario: "denial" });
    const denied = await waitFor(service, created.id, ["degraded"]);
    expect(denied.approval).toBeNull();
    expect(denied.trace.map((event) => event.type)).toContain("policy.denied");
  });

  it("uses Research's real grant to deny the controlled Finance-resource breach", async () => {
    const { service } = await createHarness();
    const created = await service.createSession({ scenario: "resource_scope_breach" });
    const failed = await waitFor(service, created.id, ["failed"]);

    expect(failed.tasks.find((task) => task.id === "research")?.status).toBe("failed");
    expect(failed.resourceAccessEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: "research",
        resource: "finance/finance-report.csv",
        decision: "DENY",
        reason: "RESOURCE_OUT_OF_SCOPE",
      }),
    ]));
    expect(failed.trace.some((event) => event.type === "retry.scheduled" && event.summary.includes("RESOURCE_ACCESS_DENIED"))).toBe(true);
  });

  it("routes the unapproved email bypass through ExecutionService and sends nothing", async () => {
    const { service, store } = await createHarness();
    const created = await service.createSession({ scenario: "bypass_protection" });
    const blocked = await waitFor(service, created.id, ["degraded"]);

    expect(blocked.approval).toBeNull();
    expect(blocked.receipts).toHaveLength(0);
    expect(await store.listReceipts(created.id)).toHaveLength(0);
    expect(blocked.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "policy.approval_required" }),
      expect.objectContaining({ type: "action.failed", summary: "NO_APPROVAL" }),
    ]));
    expect(blocked.trace.map((event) => event.type)).not.toContain("approval.requested");
  });

  it("accepts only evidence backed by an authorized read and excludes the rumor downstream", async () => {
    const { service, runner } = await createHarness();
    const created = await service.createSession({ scenario: "evidence_acceptance" });
    const settled = await waitFor(service, created.id, ["degraded", "awaiting_approval"]);
    const researchEvidence = settled.evidence!.filter((record) => record.taskId === "research");

    expect(researchEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRefs: ["resource://market/competitor-pricing.csv"], status: "accepted" }),
      expect.objectContaining({ sourceRefs: ["resource://external/unverified-rumor.txt"], status: "rejected" }),
    ]));
    expect(settled.trace.map((event) => event.type)).toEqual(expect.arrayContaining(["evidence.accepted", "evidence.rejected"]));
    const strategyPrompt = runner.requests.find((request) => request.prompt.includes('"id":"strategy"'))?.prompt ?? "";
    expect(strategyPrompt).toContain("resource://market/competitor-pricing.csv");
    expect(strategyPrompt).not.toContain("external/unverified-rumor.txt");
  });
});
