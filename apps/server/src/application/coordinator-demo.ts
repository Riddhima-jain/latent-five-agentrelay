import assert from "node:assert/strict";
import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { EvidenceRecord } from "../domain/evidence.js";
import type { AgentTask } from "../domain/task.js";
import type { TraceEvent } from "../domain/trace.js";
import type { CoordinatorPorts, CoordinatorSnapshot } from "./coordinator.js";
import { Coordinator } from "./coordinator.js";

const timestamp = "2026-08-29T00:00:00.000Z";
const executions: Array<{ agentId: string; taskId: string }> = [];
const tasks = new Map<string, AgentTask>();
const evidence: EvidenceRecord[] = [];
const traces: TraceEvent[] = [];
let savedSessionStatus = "created";

const ports: CoordinatorPorts = {
  agentExecutor: {
    async execute(agentId, task) {
      executions.push({ agentId, taskId: task.id });
      console.log(`  executed ${task.id} with ${agentId}`);
      return {
        summary: `${task.title} complete`,
        evidence: [{ claim: `${task.id} fixture finding`, sourceRefs: [`fixture://${task.id}`] }],
        proposedActions: [],
      };
    },
  },
  sessionStore: {
    async get() { return null; },
    async save(session) { savedSessionStatus = session.status; },
  },
  taskStore: {
    async get(taskId) { return tasks.get(taskId) ?? null; },
    async listBySession(sessionId) { return [...tasks.values()].filter((task) => task.sessionId === sessionId); },
    async save(task) { tasks.set(task.id, task); },
  },
  evidenceStore: {
    async save(record) { evidence.push(record); },
    async listForTasks(taskIds) { return evidence.filter((record) => taskIds.includes(record.taskId)); },
  },
  evidenceSourceAuthorizer: {
    async listAuthorizedSourceRefs({ taskId }) { return [`fixture://${taskId}`]; },
  },
  traceSink: { async append(event) { traces.push(event); } },
};

function statuses(snapshot: CoordinatorSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.tasks.map((task) => [task.id, task.status]));
}

function printSnapshot(label: string, snapshot: CoordinatorSnapshot): void {
  console.log(`\n${label}`);
  console.table(snapshot.tasks.map((task) => ({ task: task.id, state: task.status, agent: task.assignedAgentId ?? "-", attempt: task.attempt })));
}

const coordinator = new Coordinator(SALES_RECOVERY_TASKS, SALES_RECOVERY_AGENTS, ports, () => timestamp);
const started = await coordinator.start({
  id: "demo-session",
  goal: "Recover sales",
  traceId: "demo-trace",
  participantAgentIds: SALES_RECOVERY_AGENTS.map((agent) => agent.agentId),
  status: "created",
  createdAt: timestamp,
  updatedAt: timestamp,
});

assert.equal(started.started, true, "The frozen sales-recovery DAG must validate.");
if (!started.started) throw new Error("Unreachable after assertion");
printSnapshot("Start: independent roots are ready", started.snapshot);
assert.deepEqual(statuses(started.snapshot), {
  research: "ready", finance: "ready", strategy: "blocked", outreach: "blocked",
});

const afterRoots = await coordinator.tick();
printSnapshot("Tick 1: research and finance execute in parallel", afterRoots);
assert.deepEqual(statuses(afterRoots), {
  research: "completed", finance: "completed", strategy: "ready", outreach: "blocked",
});
assert.deepEqual(executions.slice(0, 2).map((run) => run.taskId).sort(), ["finance", "research"]);

const afterStrategy = await coordinator.tick();
printSnapshot("Tick 2: strategy unlocks only after both dependencies complete", afterStrategy);
assert.deepEqual(statuses(afterStrategy), {
  research: "completed", finance: "completed", strategy: "completed", outreach: "ready",
});

const completed = await coordinator.tick();
printSnapshot("Tick 3: outreach completes the workflow", completed);
assert.deepEqual(statuses(completed), {
  research: "completed", finance: "completed", strategy: "completed", outreach: "completed",
});
assert.equal(savedSessionStatus, "completed");
assert.equal(tasks.size, 4);
assert.equal(evidence.length, 4);
assert.ok(evidence.every((record) => record.status === "provisional"));
assert.ok(traces.some((event) => event.type === "task.ready"));
assert.ok(traces.some((event) => event.type === "agent.invoked"));
assert.ok(traces.some((event) => event.type === "session.completed"));

console.log("\nPASS: P1 Day 2 coordinator exit criterion verified with mocked ports.");
