import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ExecutionRecord,
  ExecutionRecordSeed,
  ExecutionStore,
} from "../application/execution-ports.js";
import { assertNoPayloadLeak, newExecutingRecord } from "./execution-record.js";

interface ExecutionLedger {
  version: 1;
  records: Record<string, ExecutionRecord>;
}

const emptyLedger = (): ExecutionLedger => ({ version: 1, records: {} });

/**
 * The idempotency ledger (plan U5). One JSON file, following `store.ts`:
 * every mutation is serialized through a promise queue and committed with a
 * temp-file + atomic `rename`. The `pending -> executing` claim is a
 * compare-and-set inside a single queued mutation (plan KTD3).
 */
export class JsonExecutionStore implements ExecutionStore {
  private data: ExecutionLedger = emptyLedger();
  private queue: Promise<void> = Promise.resolve();
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.load();
    }
    return this.initPromise;
  }

  private async load(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ExecutionLedger;
      if (parsed.version !== 1 || typeof parsed.records !== "object") {
        throw new Error("Unsupported execution ledger format");
      }
      this.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await this.persist(this.data);
    }
  }

  async get(idempotencyKey: string): Promise<ExecutionRecord | null> {
    await this.ensureInitialized();
    const record = this.data.records[idempotencyKey];
    return record ? structuredClone(record) : null;
  }

  async claim(seed: ExecutionRecordSeed): Promise<ExecutionRecord | null> {
    await this.ensureInitialized();
    return this.mutate((ledger) => {
      if (ledger.records[seed.idempotencyKey]) {
        return null;
      }
      const record = newExecutingRecord(seed, this.now().toISOString());
      ledger.records[record.idempotencyKey] = record;
      return structuredClone(record);
    });
  }

  async update(record: ExecutionRecord): Promise<void> {
    assertNoPayloadLeak(record);
    await this.ensureInitialized();
    await this.mutate((ledger) => {
      const next = structuredClone(record);
      next.updatedAt = this.now().toISOString();
      ledger.records[next.idempotencyKey] = next;
    });
  }

  private async ensureInitialized(): Promise<void> {
    await this.initialize();
  }

  private async mutate<T>(mutation: (ledger: ExecutionLedger) => T): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      result = mutation(next);
      await this.persist(next);
      this.data = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async persist(data: ExecutionLedger): Promise<void> {
    const temporaryPath = this.filePath + ".tmp";
    await writeFile(temporaryPath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
