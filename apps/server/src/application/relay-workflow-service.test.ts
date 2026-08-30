import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRunner, RunnerRequest } from "../types.js";
import { InMemoryExecutionStore } from "../adapters/in-memory-execution-store.js";
import { MockEmailExecutor } from "./email-executor.js";
import { RelayJsonStore } from "./relay-store.js";
import { RelayWorkflowService } from "./relay-workflow-service.js";

class WorkflowRunner implements AgentRunner {
  async run(request: RunnerRequest) {
    const task = /"id":"([^"]+)"/.exec(request.prompt)?.[1] ?? "unknown";
    const action = task === "outreach" ? [{ type: "SEND_EMAIL", target: "customer@example.com", payload: { recipient: "customer@example.com", subject: "Recovery plan", body: "Hello from AgentRelay" }, rationale: "Approved recovery strategy" }] : [];
    return { output: JSON.stringify({ summary: `${task} completed`, evidence: [{ claim: `${task} evidence`, sourceRefs: ["fixture://source"] }], proposedActions: action }), threadId: `thread-${task}`, usage: null };
  }
  async cancel() { return true; }
  async isAvailable() { return true; }
}

async function createHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentrelay-workflow-"));
  const store = new RelayJsonStore(path.join(root, "relay.json"));
  const executionStore = new InMemoryExecutionStore();
  const service = new RelayWorkflowService(store, new WorkflowRunner(), new MockEmailExecutor(store), path.join(root, "workspaces"), path.resolve("../../fixtures/sales-recovery"), () => new Date().toISOString(), () => "fixed-session-id", () => Promise.resolve(true), executionStore);
  await service.initialize();
  return { root, store, service, executionStore };
}

async function waitFor(service: RelayWorkflowService, id: string, statuses: string[]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

  it("persists an approval-ready session across service restart", async () => {
    const { root, service } = await createHarness();
    const created = await service.createSession();
    await waitFor(service, created.id, ["awaiting_approval"]);

    const restartedStore = new RelayJsonStore(path.join(root, "relay.json"));
    const restarted = new RelayWorkflowService(restartedStore, new WorkflowRunner(), new MockEmailExecutor(restartedStore), path.join(root, "workspaces"), path.resolve("../../fixtures/sales-recovery"));
    await restarted.initialize();
    expect((await restarted.getSession(created.id)).status).toBe("awaiting_approval");
  });

  it("records real coordinator retries and failure for the controlled timeout", async () => {
    const { service } = await createHarness();
    const created = await service.createSession({ scenario: "timeout" });
    const failed = await waitFor(service, created.id, ["failed"]);
    expect(failed.trace.filter((event) => event.type === "retry.scheduled")).not.toHaveLength(0);
    expect(failed.tasks.find((task) => task.id === "research")?.status).toBe("failed");
  });

  it("runs the real coordinator output through the prohibited-action policy", async () => {
    const { service } = await createHarness();
    const created = await service.createSession({ scenario: "denial" });
    const denied = await waitFor(service, created.id, ["degraded"]);
    expect(denied.approval).toBeNull();
    expect(denied.trace.map((event) => event.type)).toContain("policy.denied");
  });
});
