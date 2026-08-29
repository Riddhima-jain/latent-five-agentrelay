import { describe, expect, it } from "vitest";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { AgentManifest } from "../domain/capability.js";
import type { EvidenceRecord } from "../domain/evidence.js";
import type { CoordinatorPorts } from "./coordinator.js";
import { Coordinator } from "./coordinator.js";

const fixedClock = () => "2026-08-29T00:00:00.000Z";
const session = () => ({
  id: "session-1", goal: "Recover sales", traceId: "trace-1", participantAgentIds: SALES_RECOVERY_AGENTS.map((agent) => agent.agentId),
  status: "created" as const, createdAt: fixedClock(), updatedAt: fixedClock(),
});

function makePorts(overrides: Partial<CoordinatorPorts> = {}) {
  const calls: Array<{ agentId: string; taskId: string; evidence: EvidenceRecord[] }> = [];
  const savedEvidence: EvidenceRecord[] = [];
  const traces: Array<{ type: string; taskId?: string }> = [];
  let savedSession = session();
  const ports: CoordinatorPorts = {
    agentExecutor: { async execute(agentId, task, context) {
      calls.push({ agentId, taskId: task.id, evidence: context.dependencyEvidence });
      return { summary: task.title, evidence: [{ claim: `${task.id} finding`, sourceRefs: [`fixture://${task.id}`] }], proposedActions: [] };
    } },
    sessionStore: { async get() { return savedSession; }, async save(value) { savedSession = value; } },
    taskStore: { async get() { return null; }, async listBySession() { return []; }, async save() {} },
    evidenceStore: {
      async save(record) { savedEvidence.push(record); },
      async listForTasks(taskIds) { return savedEvidence.filter((record) => taskIds.includes(record.taskId)); },
    },
    traceSink: { async append(event) { traces.push({ type: event.type, taskId: event.taskId }); } },
    ...overrides,
  };
  return { ports, calls, savedEvidence, traces, getSession: () => savedSession };
}

function statusOf(snapshot: ReturnType<Coordinator["getSnapshot"]>, taskId: string) {
  return snapshot.tasks.find((task) => task.id === taskId)?.status;
}

describe("Coordinator", () => {
  it("runs independent roots in parallel and unlocks strategy only after both complete", async () => {
    const harness = makePorts();
    const coordinator = new Coordinator(SALES_RECOVERY_TASKS, SALES_RECOVERY_AGENTS, harness.ports, fixedClock);
    await expect(coordinator.start(session())).resolves.toMatchObject({ started: true, snapshot: { readyTaskIds: ["research", "finance"] } });
    const afterRoots = await coordinator.tick();
    expect(harness.calls.map(({ agentId, taskId }) => ({ agentId, taskId }))).toEqual([
      { agentId: "research-agent", taskId: "research" }, { agentId: "finance-agent", taskId: "finance" },
    ]);
    expect(statusOf(afterRoots, "research")).toBe("completed");
    expect(statusOf(afterRoots, "finance")).toBe("completed");
    expect(statusOf(afterRoots, "strategy")).toBe("ready");
    expect(statusOf(afterRoots, "outreach")).toBe("blocked");
  });

  it("uses only accepted, same-session dependency evidence in an executor context", async () => {
    const harness = makePorts();
    const coordinator = new Coordinator(SALES_RECOVERY_TASKS, SALES_RECOVERY_AGENTS, harness.ports, fixedClock);
    await coordinator.start(session());
    await coordinator.tick();
    harness.savedEvidence[1]!.status = "rejected";
    harness.savedEvidence.push({ ...harness.savedEvidence[1]!, id: "other-session", sessionId: "other", status: "accepted" });
    await coordinator.tick();
    const strategy = harness.calls.find((call) => call.taskId === "strategy")!;
    expect(strategy.evidence).toHaveLength(1);
    expect(strategy.evidence[0]!.taskId).toBe("research");
  });

  it("persists accepted evidence and correlated task, agent, and session trace events", async () => {
    const harness = makePorts();
    const coordinator = new Coordinator(SALES_RECOVERY_TASKS, SALES_RECOVERY_AGENTS, harness.ports, fixedClock);
    await coordinator.start(session());
    await coordinator.tick(); await coordinator.tick(); await coordinator.tick();
    expect(harness.savedEvidence).toHaveLength(4);
    expect(harness.savedEvidence.every((record) => record.status === "accepted")).toBe(true);
    expect(harness.traces.map((event) => event.type)).toEqual(expect.arrayContaining([
      "task.created", "task.ready", "agent.selected", "agent.invoked", "evidence.created", "task.completed", "session.completed",
    ]));
    expect(harness.getSession().status).toBe("completed");
  });

  it("coalesces overlapping ticks so each ready task executes only once", async () => {
    let releaseExecution: () => void = () => {};
    let markAgentStarted: () => void = () => {};
    const agentStarted = new Promise<void>((resolve) => { markAgentStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseExecution = resolve; });
    const harness = makePorts({ agentExecutor: { async execute(agentId, task, context) {
      harness.calls.push({ agentId, taskId: task.id, evidence: context.dependencyEvidence });
      markAgentStarted();
      await release;
      return { summary: "ok", evidence: [], proposedActions: [] };
    } } });
    const coordinator = new Coordinator(SALES_RECOVERY_TASKS, SALES_RECOVERY_AGENTS, harness.ports, fixedClock);
    await coordinator.start(session());

    const firstTick = coordinator.tick();
    await agentStarted;
    const secondTick = coordinator.tick();
    releaseExecution();
    await Promise.all([firstTick, secondTick]);

    expect(harness.calls).toHaveLength(2);
    expect(harness.calls.map((call) => call.taskId).sort()).toEqual(["finance", "research"]);
  });

  it("retries a failed task once, preserving dependency blocking until it succeeds", async () => {
    let researchAttempts = 0;
    const harness = makePorts({ agentExecutor: { async execute(_agentId, task) {
      if (task.id === "research" && researchAttempts++ === 0) throw new Error("temporary failure");
      return { summary: "ok", evidence: [], proposedActions: [] };
    } } });
    const coordinator = new Coordinator(SALES_RECOVERY_TASKS, SALES_RECOVERY_AGENTS, harness.ports, fixedClock);
    await coordinator.start(session());

    const retryScheduled = await coordinator.tick();
    expect(statusOf(retryScheduled, "research")).toBe("ready");
    expect(statusOf(retryScheduled, "strategy")).toBe("blocked");
    expect(harness.getSession().status).toBe("running");

    const recovered = await coordinator.tick();
    expect(statusOf(recovered, "research")).toBe("completed");
    expect(statusOf(recovered, "strategy")).toBe("ready");
    expect(harness.traces.map((event) => event.type)).toContain("retry.scheduled");
  });

  it("marks unavailable work unassigned and blocks its descendants", async () => {
    const agents: AgentManifest[] = SALES_RECOVERY_AGENTS.map((agent) =>
      agent.agentId === "finance-agent" ? { ...agent, runnable: false } : agent,
    );
    const harness = makePorts();
    const coordinator = new Coordinator(
      SALES_RECOVERY_TASKS,
      agents,
      harness.ports,
      fixedClock,
      new Set(SALES_RECOVERY_AGENTS.flatMap((agent) => agent.capabilities)),
    );
    await coordinator.start(session());
    const snapshot = await coordinator.tick();

    expect(statusOf(snapshot, "finance")).toBe("unassigned");
    expect(statusOf(snapshot, "strategy")).toBe("blocked");
    expect(snapshot.blockedByFailedDependencyTaskIds).toEqual(["strategy"]);
    expect(harness.getSession().status).toBe("failed");
  });

  it("fails the session only after a task exhausts its retry attempts", async () => {
    const harness = makePorts({ agentExecutor: { async execute(_agentId, task) {
      if (task.id === "research") throw new Error("controlled failure");
      return { summary: "ok", evidence: [], proposedActions: [] };
    } } });
    const coordinator = new Coordinator(SALES_RECOVERY_TASKS, SALES_RECOVERY_AGENTS, harness.ports, fixedClock);
    await coordinator.start(session());
    const retryScheduled = await coordinator.tick();
    expect(statusOf(retryScheduled, "research")).toBe("ready");

    const snapshot = await coordinator.tick();
    expect(statusOf(snapshot, "research")).toBe("failed");
    expect(statusOf(snapshot, "strategy")).toBe("blocked");
    expect(snapshot.blockedByFailedDependencyTaskIds).toEqual(["strategy"]);
    expect(harness.getSession().status).toBe("failed");
  });
});
