import assert from "node:assert/strict";
import type { AgentManifest } from "../domain/capability.js";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { EvidenceRecord } from "../domain/evidence.js";
import type { SharedSession } from "../domain/session.js";
import type { AgentExecutionResult, AgentTask, TaskStatus } from "../domain/task.js";
import type { TraceEvent } from "../domain/trace.js";
import type { CoordinatorPorts, CoordinatorSnapshot } from "./coordinator.js";
import { Coordinator } from "./coordinator.js";

const timestamp = "2026-08-29T00:00:00.000Z";
const successfulResult: AgentExecutionResult = { summary: "fixture success", evidence: [], proposedActions: [] };

type Execute = (agentId: string, task: AgentTask) => Promise<AgentExecutionResult>;

function createSession(id: string): SharedSession {
  return {
    id,
    goal: "Recover sales",
    traceId: `trace-${id}`,
    participantAgentIds: SALES_RECOVERY_AGENTS.map((agent) => agent.agentId),
    status: "created",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function status(snapshot: CoordinatorSnapshot, taskId: string): TaskStatus {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  assert.ok(task, `Task ${taskId} must exist.`);
  return task.status;
}

function createHarness(execute: Execute) {
  const calls: Array<{ agentId: string; taskId: string }> = [];
  const storedTasks = new Map<string, AgentTask>();
  const evidence: EvidenceRecord[] = [];
  const traces: TraceEvent[] = [];
  let storedSession: SharedSession | null = null;
  const ports: CoordinatorPorts = {
    agentExecutor: {
      async execute(agentId, task) {
        calls.push({ agentId, taskId: task.id });
        return execute(agentId, task);
      },
    },
    sessionStore: {
      async get() { return storedSession; },
      async save(session) { storedSession = session; },
    },
    taskStore: {
      async get(taskId) { return storedTasks.get(taskId) ?? null; },
      async listBySession(sessionId) { return [...storedTasks.values()].filter((task) => task.sessionId === sessionId); },
      async save(task) { storedTasks.set(task.id, task); },
    },
    evidenceStore: {
      async save(record) { evidence.push(record); },
      async listForTasks(taskIds) { return evidence.filter((record) => taskIds.includes(record.taskId)); },
    },
    traceSink: { async append(event) { traces.push(event); } },
  };
  return { ports, calls, storedTasks, traces, getSession: () => storedSession };
}

async function start(
  label: string,
  harness: ReturnType<typeof createHarness>,
  agents: readonly AgentManifest[] = SALES_RECOVERY_AGENTS,
): Promise<Coordinator> {
  const coordinator = new Coordinator(
    SALES_RECOVERY_TASKS,
    agents,
    harness.ports,
    () => timestamp,
    new Set(SALES_RECOVERY_AGENTS.flatMap((agent) => agent.capabilities)),
  );
  const result = await coordinator.start(createSession(label));
  assert.equal(result.started, true, `${label}: DAG validation must pass.`);
  return coordinator;
}

async function demonstrateHappyPath(): Promise<void> {
  const harness = createHarness(async () => successfulResult);
  const coordinator = await start("happy", harness);
  const first = await coordinator.tick();
  assert.equal(status(first, "research"), "completed");
  assert.equal(status(first, "finance"), "completed");
  assert.equal(status(first, "strategy"), "ready");
  await coordinator.tick();
  const done = await coordinator.tick();
  assert.ok(done.tasks.every((task) => task.status === "completed"));
  assert.equal(harness.getSession()?.status, "completed");
  console.log("PASS happy path: parallel roots, ordered dependencies, completed session");
}

async function demonstrateDuplicateTickProtection(): Promise<void> {
  let release: () => void = () => {};
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const harness = createHarness(async () => { markStarted(); await gate; return successfulResult; });
  const coordinator = await start("duplicate", harness);
  const first = coordinator.tick();
  await started;
  const duplicate = coordinator.tick();
  release();
  await Promise.all([first, duplicate]);
  assert.equal(harness.calls.length, 2, "Two roots must execute once each, not twice.");
  console.log("PASS duplicate tick: one in-flight scheduler run, no duplicate task execution");
}

async function demonstrateRetryAndRecovery(): Promise<void> {
  let researchAttempts = 0;
  const harness = createHarness(async (_agentId, task) => {
    if (task.id === "research" && researchAttempts++ === 0) throw new Error("controlled transient failure");
    return successfulResult;
  });
  const coordinator = await start("retry", harness);
  const retry = await coordinator.tick();
  assert.equal(status(retry, "research"), "ready");
  assert.equal(status(retry, "strategy"), "blocked");
  const recovered = await coordinator.tick();
  assert.equal(status(recovered, "research"), "completed");
  assert.equal(status(recovered, "strategy"), "ready");
  assert.ok(harness.traces.some((event) => event.type === "retry.scheduled"));
  console.log("PASS retry: RUNNING -> READY -> COMPLETED, downstream remains blocked until recovery");
}

async function demonstrateUnavailableAgent(): Promise<void> {
  const agents = SALES_RECOVERY_AGENTS.map((agent) =>
    agent.agentId === "finance-agent" ? { ...agent, runnable: false } : agent,
  );
  const harness = createHarness(async () => successfulResult);
  const coordinator = await start("unavailable", harness, agents);
  const snapshot = await coordinator.tick();
  assert.equal(status(snapshot, "finance"), "unassigned");
  assert.equal(status(snapshot, "strategy"), "blocked");
  assert.equal(harness.getSession()?.status, "failed");
  console.log("PASS unavailable agent: task is UNASSIGNED, descendants remain blocked, session fails");
}

async function demonstrateTerminalFailure(): Promise<void> {
  const harness = createHarness(async (_agentId, task) => {
    if (task.id === "research") throw new Error("controlled permanent failure");
    return successfulResult;
  });
  const coordinator = await start("terminal", harness);
  const retry = await coordinator.tick();
  assert.equal(status(retry, "research"), "ready");
  const terminal = await coordinator.tick();
  assert.equal(status(terminal, "research"), "failed");
  assert.equal(status(terminal, "strategy"), "blocked");
  assert.equal(harness.getSession()?.status, "failed");
  console.log("PASS terminal failure: max attempts exhausted, descendants blocked, session failed");
}

await demonstrateHappyPath();
await demonstrateDuplicateTickProtection();
await demonstrateRetryAndRecovery();
await demonstrateUnavailableAgent();
await demonstrateTerminalFailure();
console.log("\nPASS: P1 Day 3 coordinator exit criterion is satisfied with mocked ports.");
