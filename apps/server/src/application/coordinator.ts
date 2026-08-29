import type { AgentManifest } from "../domain/capability.js";
import type { EvidenceRecord } from "../domain/evidence.js";
import type { AgentExecutor, EvidenceStore, ExecutionContext, SessionStore, TaskStore, TraceSink } from "../domain/ports.js";
import type { SharedSession } from "../domain/session.js";
import type { AgentTask, WorkflowTaskDefinition } from "../domain/task.js";
import type { TraceEvent, TraceEventType } from "../domain/trace.js";
import { routeTaskByCapability } from "./capability-router.js";
import { applyEvidenceAcceptance } from "./evidence-acceptance.js";
import type { DagValidationError } from "./dag-validator.js";
import { validateTaskDag } from "./dag-validator.js";
import { scheduleReadyTasks } from "./scheduler.js";
import { transitionTask } from "./task-lifecycle.js";

/** The Coordinator depends only on these replaceable domain ports. */
export interface CoordinatorPorts {
  agentExecutor: AgentExecutor;
  sessionStore: SessionStore;
  taskStore: TaskStore;
  evidenceStore: EvidenceStore;
  traceSink: TraceSink;
}

export interface CoordinatorSnapshot {
  tasks: AgentTask[];
  readyTaskIds: string[];
  blockedByFailedDependencyTaskIds: string[];
}

export type CoordinatorStartResult =
  | { started: true; snapshot: CoordinatorSnapshot }
  | { started: false; errors: DagValidationError[] };

/** Dependency-aware coordinator with no Fastify, Codex, or storage implementation dependency. */
export class Coordinator {
  private tasks: AgentTask[] = [];
  private session: SharedSession | null = null;
  private latestSnapshot: CoordinatorSnapshot | null = null;
  private tickInFlight: Promise<CoordinatorSnapshot> | null = null;

  constructor(
    private readonly definitions: readonly WorkflowTaskDefinition[],
    private readonly agents: readonly AgentManifest[],
    private readonly ports: CoordinatorPorts,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly knownCapabilities: ReadonlySet<string> = new Set(agents.flatMap((agent) => agent.capabilities)),
    private readonly resourcesForTask: (task: AgentTask) => readonly string[] = () => [],
  ) {}

  async start(session: SharedSession): Promise<CoordinatorStartResult> {
    const validation = validateTaskDag(this.definitions, this.knownCapabilities);
    if (!validation.valid) return { started: false, errors: validation.errors };

    const timestamp = this.now();
    this.session = { ...session, status: "running", updatedAt: timestamp };
    this.tasks = this.definitions.map((definition) => ({
      ...definition, sessionId: session.id, status: "blocked", attempt: 0, createdAt: timestamp, updatedAt: timestamp,
    }));
    await this.ports.sessionStore.save(this.session);
    await Promise.all(this.tasks.map((task) => this.ports.taskStore.save(task)));
    await Promise.all(this.tasks.map((task) => this.trace("task.created", { taskId: task.id })));
    return { started: true, snapshot: await this.reconcileReadiness() };
  }

  getSnapshot(): CoordinatorSnapshot {
    if (!this.latestSnapshot) throw new Error("Coordinator has not been started.");
    return this.latestSnapshot;
  }

  /** Executes every currently ready task concurrently, then reconciles downstream readiness. */
  tick(): Promise<CoordinatorSnapshot> {
    if (this.tickInFlight) return this.tickInFlight;
    this.tickInFlight = this.runTick().finally(() => {
      this.tickInFlight = null;
    });
    return this.tickInFlight;
  }

  private async runTick(): Promise<CoordinatorSnapshot> {
    const readyTasks = this.getSnapshot().tasks.filter((task) => task.status === "ready");
    const updatedTasks = await Promise.all(readyTasks.map((task) => this.executeTask(task)));
    const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
    this.tasks = this.tasks.map((task) => updatedById.get(task.id) ?? task);
    return this.reconcileReadiness();
  }

  private async executeTask(task: AgentTask): Promise<AgentTask> {
    const route = routeTaskByCapability(task, this.agents);
    if (route.status === "UNASSIGNED") {
      return this.persistTransition(task, "unassigned", "task.failed", { reason: route.reason });
    }

    const assignedTask = { ...task, assignedAgentId: route.agentId, updatedAt: this.now() };
    await this.ports.taskStore.save(assignedTask);
    await this.trace("agent.selected", { taskId: task.id, agentId: route.agentId });
    const running = await this.persistTransition(assignedTask, "running", "task.started");
    if (running.status !== "running") return running;

    try {
      const context = await this.buildContext(running);
      await this.trace("agent.invoked", { taskId: task.id, agentId: route.agentId });
      const result = await this.ports.agentExecutor.execute(route.agentId, running, context);
      const completed = await this.persistTransition(running, "completed", "task.completed");
      await this.persistEvidence(completed, route.agentId, result.evidence);
      await Promise.all(result.proposedActions.map((action, index) => this.trace("action.proposed", {
        taskId: task.id, agentId: route.agentId, metadata: { actionIndex: index, actionType: action.type, target: action.target },
      })));
      return completed;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Agent execution failed";
      if (running.attempt < running.maxAttempts) {
        return this.persistTransition(running, "ready", "retry.scheduled", {
          attempt: running.attempt,
          reason,
        });
      }
      return this.persistTransition(running, "failed", "task.failed", {
        reason,
      });
    }
  }

  private async buildContext(task: AgentTask): Promise<ExecutionContext> {
    if (!this.session) throw new Error("Coordinator has not been started.");
    const evidence = await this.ports.evidenceStore.listForTasks(task.dependsOn);
    return {
      sessionId: this.session.id, taskId: task.id, goal: this.session.goal, constraints: [],
      allowedResources: [...this.resourcesForTask(task)],
      dependencyEvidence: evidence.filter((record) => record.sessionId === this.session?.id && record.status === "accepted"),
    };
  }

  private async persistEvidence(task: AgentTask, agentId: string, evidence: readonly { claim: string; sourceRefs: string[] }[]): Promise<void> {
    await Promise.all(evidence.map((item, index) => {
      const provisional: EvidenceRecord = {
        id: `${task.sessionId}:${task.id}:evidence:${index + 1}`, sessionId: task.sessionId, taskId: task.id,
        producerAgentId: agentId, status: "provisional", claim: item.claim, sourceRefs: [...item.sourceRefs], createdAt: this.now(),
      };
      const record = applyEvidenceAcceptance(provisional, task);
      return Promise.all([
        this.ports.evidenceStore.save(record),
        this.trace("evidence.created", { taskId: task.id, agentId, metadata: { evidenceId: record.id } }),
      ]);
    }));
  }

  private async persistTransition(task: AgentTask, status: AgentTask["status"], eventType: TraceEventType, metadata?: Record<string, unknown>): Promise<AgentTask> {
    const transition = transitionTask(task, status, this.now());
    if (!transition.transitioned) return task;
    await this.ports.taskStore.save(transition.task);
    await this.trace(eventType, {
      taskId: task.id,
      ...(task.assignedAgentId ? { agentId: task.assignedAgentId } : {}),
      ...(metadata ? { metadata } : {}),
    });
    return transition.task;
  }

  private async reconcileReadiness(): Promise<CoordinatorSnapshot> {
    const scheduling = scheduleReadyTasks(this.tasks, this.now());
    const newlyReady = scheduling.tasks.filter((task) => task.status === "ready" && this.tasks.find((prior) => prior.id === task.id)?.status !== "ready");
    this.tasks = scheduling.tasks;
    await Promise.all(this.tasks.map((task) => this.ports.taskStore.save(task)));
    await Promise.all(newlyReady.map((task) => this.trace("task.ready", { taskId: task.id })));
    await this.updateSessionStatus();
    this.latestSnapshot = {
      tasks: this.tasks.map((task) => ({ ...task })), readyTaskIds: [...scheduling.readyTaskIds],
      blockedByFailedDependencyTaskIds: [...scheduling.blockedByFailedDependencyTaskIds],
    };
    return this.getSnapshot();
  }

  private async updateSessionStatus(): Promise<void> {
    if (!this.session) return;
    const allCompleted = this.tasks.length > 0 && this.tasks.every((task) => task.status === "completed");
    const terminalFailure = this.tasks.some((task) => task.status === "failed" || task.status === "unassigned");
    if (!allCompleted && !terminalFailure) return;
    const status = allCompleted ? "completed" : "failed";
    if (this.session.status === status) return;
    this.session = { ...this.session, status, updatedAt: this.now() };
    await this.ports.sessionStore.save(this.session);
    await this.trace(status === "completed" ? "session.completed" : "session.failed");
  }

  private async trace(
    type: TraceEventType,
    details: Pick<Partial<TraceEvent>, "taskId" | "agentId" | "runId" | "metadata"> = {},
  ): Promise<void> {
    if (!this.session) return;
    await this.ports.traceSink.append({
      id: `${this.session.id}:${type}:${this.now()}:${details.taskId ?? "session"}`,
      traceId: this.session.traceId, sessionId: this.session.id, type, timestamp: this.now(), ...details,
    });
  }
}
