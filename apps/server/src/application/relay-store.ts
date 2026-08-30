import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProposedAction } from "../domain/action.js";
import type { ApprovalRecord } from "../domain/approval.js";
import type { EvidenceRecord } from "../domain/evidence.js";
import type { SessionStore, TaskStore, EvidenceStore, TraceSink } from "../domain/ports.js";
import type { SharedSession } from "../domain/session.js";
import type { AgentTask } from "../domain/task.js";
import type { TraceEvent } from "../domain/trace.js";

export interface RelayTaskResult {
  sessionId: string;
  taskId: string;
  summary: string;
  createdAt: string;
}

export interface RelayActionReceipt {
  actionId: string;
  sessionId: string;
  provider: "mock" | "resend";
  externalReference: string;
  acceptedAt: string;
  idempotencyKey: string;
}

interface RelayDatabase {
  version: 1;
  sessions: SharedSession[];
  tasks: AgentTask[];
  evidence: EvidenceRecord[];
  traces: TraceEvent[];
  actions: ProposedAction[];
  approvals: ApprovalRecord[];
  taskResults: RelayTaskResult[];
  receipts: RelayActionReceipt[];
}

const emptyDatabase = (): RelayDatabase => ({
  version: 1, sessions: [], tasks: [], evidence: [], traces: [], actions: [],
  approvals: [], taskResults: [], receipts: [],
});

/** Single-process durable Relay repository with serialized atomic file replacement. */
export class RelayJsonStore implements SessionStore, TraceSink {
  private data = emptyDatabase();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<RelayDatabase>;
      if (parsed.version !== 1 || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.tasks)) {
        throw new Error("Unsupported Relay database format");
      }
      this.data = {
        ...emptyDatabase(), ...parsed,
        evidence: parsed.evidence ?? [], traces: parsed.traces ?? [], actions: parsed.actions ?? [],
        approvals: parsed.approvals ?? [], taskResults: parsed.taskResults ?? [], receipts: parsed.receipts ?? [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  /** Clears only AgentRelay workflow state; Starter Kit Agents and workspaces live in a separate store. */
  async resetDemo(): Promise<void> {
    await this.mutate((database) => {
      Object.assign(database, emptyDatabase());
    });
  }

  async get(sessionId: string): Promise<SharedSession | null> {
    return structuredClone(this.data.sessions.find((session) => session.id === sessionId) ?? null);
  }

  async listSessions(): Promise<SharedSession[]> { return structuredClone(this.data.sessions); }
  async save(session: SharedSession): Promise<void> { await this.upsert("sessions", session, (item) => item.id); }
  async getTask(taskId: string): Promise<AgentTask | null> { return structuredClone(this.data.tasks.find((task) => task.id === taskId) ?? null); }
  async listBySession(sessionId: string): Promise<AgentTask[]> { return structuredClone(this.data.tasks.filter((task) => task.sessionId === sessionId)); }
  async saveTask(task: AgentTask): Promise<void> { await this.upsert("tasks", task, (item) => `${item.sessionId}:${item.id}`); }
  async saveEvidence(record: EvidenceRecord): Promise<void> { await this.upsert("evidence", record, (item) => item.id); }
  async listForTasks(taskIds: string[]): Promise<EvidenceRecord[]> { return structuredClone(this.data.evidence.filter((record) => taskIds.includes(record.taskId))); }
  async listEvidence(sessionId: string): Promise<EvidenceRecord[]> { return structuredClone(this.data.evidence.filter((record) => record.sessionId === sessionId)); }
  async append(event: TraceEvent): Promise<void> { await this.upsert("traces", event, (item) => item.id); }
  async listTrace(sessionId: string): Promise<TraceEvent[]> { return structuredClone(this.data.traces.filter((event) => event.sessionId === sessionId)); }
  async saveAction(action: ProposedAction): Promise<void> { await this.upsert("actions", action, (item) => item.id); }
  async getAction(actionId: string): Promise<ProposedAction | null> { return structuredClone(this.data.actions.find((action) => action.id === actionId) ?? null); }
  async listActions(sessionId: string): Promise<ProposedAction[]> { return structuredClone(this.data.actions.filter((action) => action.sessionId === sessionId)); }
  async saveApproval(approval: ApprovalRecord): Promise<void> { await this.upsert("approvals", approval, (item) => item.id); }
  async getApproval(approvalId: string): Promise<ApprovalRecord | null> { return structuredClone(this.data.approvals.find((approval) => approval.id === approvalId) ?? null); }
  async saveTaskResult(result: RelayTaskResult): Promise<void> { await this.upsert("taskResults", result, (item) => `${item.sessionId}:${item.taskId}`); }
  async listTaskResults(sessionId: string): Promise<RelayTaskResult[]> { return structuredClone(this.data.taskResults.filter((result) => result.sessionId === sessionId)); }
  async saveReceipt(receipt: RelayActionReceipt): Promise<void> { await this.upsert("receipts", receipt, (item) => item.idempotencyKey); }
  async getReceipt(idempotencyKey: string): Promise<RelayActionReceipt | null> { return structuredClone(this.data.receipts.find((receipt) => receipt.idempotencyKey === idempotencyKey) ?? null); }
  async listReceipts(sessionId: string): Promise<RelayActionReceipt[]> { return structuredClone(this.data.receipts.filter((receipt) => receipt.sessionId === sessionId)); }

  /** Port aliases keep the domain interfaces small without leaking persistence details. */
  readonly taskStore: TaskStore = { get: (id) => this.getTask(id), listBySession: (id) => this.listBySession(id), save: (task) => this.saveTask(task) };
  readonly evidenceStore: EvidenceStore = { save: (record) => this.saveEvidence(record), listForTasks: (ids) => this.listForTasks(ids) };

  private async upsert<K extends keyof RelayDatabase, T extends RelayDatabase[K] extends Array<infer U> ? U : never>(
    collection: K, value: T, key: (item: T) => string,
  ): Promise<void> {
    await this.mutate((database) => {
      const items = database[collection] as T[];
      const index = items.findIndex((item) => key(item) === key(value));
      if (index === -1) items.push(structuredClone(value)); else items[index] = structuredClone(value);
    });
  }

  private async mutate(mutation: (database: RelayDatabase) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      mutation(next);
      await this.persist(next);
      this.data = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }

  private async persist(data: RelayDatabase = this.data): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
