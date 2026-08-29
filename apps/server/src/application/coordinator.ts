import type { AgentManifest } from "../domain/capability.js";
import type { AgentTask, WorkflowTaskDefinition } from "../domain/task.js";
import { routeTaskByCapability } from "./capability-router.js";
import type { DagValidationError } from "./dag-validator.js";
import { validateTaskDag } from "./dag-validator.js";
import { scheduleReadyTasks } from "./scheduler.js";
import { transitionTask } from "./task-lifecycle.js";

/** Day-1 seam. Day 2 replaces this with the shared AgentExecutor port. */
export interface FakeAgentExecutor {
  execute(agentId: string, task: AgentTask): Promise<void>;
}

export interface CoordinatorSnapshot {
  tasks: AgentTask[];
  readyTaskIds: string[];
  blockedByFailedDependencyTaskIds: string[];
}

export type CoordinatorStartResult =
  | { started: true; snapshot: CoordinatorSnapshot }
  | { started: false; errors: DagValidationError[] };

/**
 * In-memory Day-1 workflow coordinator. It owns ordering and state transitions only;
 * it deliberately has no direct dependency on Fastify, Codex, persistence, or policy.
 */
export class Coordinator {
  private tasks: AgentTask[] = [];
  private latestSnapshot: CoordinatorSnapshot | null = null;

  constructor(
    private readonly definitions: readonly WorkflowTaskDefinition[],
    private readonly agents: readonly AgentManifest[],
    private readonly executor: FakeAgentExecutor,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly knownCapabilities: ReadonlySet<string> = new Set(
      agents.flatMap((agent) => agent.capabilities),
    ),
  ) {}

  start(sessionId: string): CoordinatorStartResult {
    const validation = validateTaskDag(this.definitions, this.knownCapabilities);
    if (!validation.valid) return { started: false, errors: validation.errors };

    const timestamp = this.now();
    this.tasks = this.definitions.map((definition) => ({
      ...definition,
      sessionId,
      status: "blocked",
      attempt: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    return { started: true, snapshot: this.reconcileReadiness() };
  }

  getSnapshot(): CoordinatorSnapshot {
    if (!this.latestSnapshot) {
      throw new Error("Coordinator has not been started.");
    }
    return this.latestSnapshot;
  }

  /** Executes every currently ready task concurrently, then reconciles downstream readiness. */
  async tick(): Promise<CoordinatorSnapshot> {
    const snapshot = this.getSnapshot();
    const readyTasks = snapshot.tasks.filter((task) => task.status === "ready");
    const updatedTasks = await Promise.all(readyTasks.map((task) => this.executeTask(task)));
    const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
    this.tasks = this.tasks.map((task) => updatedById.get(task.id) ?? task);
    return this.reconcileReadiness();
  }

  private async executeTask(task: AgentTask): Promise<AgentTask> {
    const route = routeTaskByCapability(task, this.agents);
    if (route.status === "UNASSIGNED") {
      const transition = transitionTask(task, "unassigned", this.now());
      return transition.transitioned ? transition.task : task;
    }

    const assignedTask: AgentTask = {
      ...task,
      assignedAgentId: route.agentId,
      updatedAt: this.now(),
    };
    const running = transitionTask(assignedTask, "running", this.now());
    if (!running.transitioned) return assignedTask;

    try {
      await this.executor.execute(route.agentId, running.task);
      const completed = transitionTask(running.task, "completed", this.now());
      return completed.transitioned ? completed.task : running.task;
    } catch {
      const failed = transitionTask(running.task, "failed", this.now());
      return failed.transitioned ? failed.task : running.task;
    }
  }

  private reconcileReadiness(): CoordinatorSnapshot {
    const scheduling = scheduleReadyTasks(this.tasks, this.now());
    this.tasks = scheduling.tasks;
    this.latestSnapshot = {
      tasks: this.tasks.map((task) => ({ ...task })),
      readyTaskIds: [...scheduling.readyTaskIds],
      blockedByFailedDependencyTaskIds: [...scheduling.blockedByFailedDependencyTaskIds],
    };
    return this.getSnapshot();
  }
}
