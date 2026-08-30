import type {
  ExecutionRecord,
  ExecutionRecordSeed,
  ExecutionStore,
} from "../application/execution-ports.js";
import { assertNoPayloadLeak, newExecutingRecord } from "./execution-record.js";

/**
 * In-memory `ExecutionStore` for other people's tests and for isolated
 * development (plan integration strategy: `new InMemoryExecutionStore()`).
 * `claim` is single-winner under concurrent calls via a promise-chain mutex.
 */
export class InMemoryExecutionStore implements ExecutionStore {
  private readonly records = new Map<string, ExecutionRecord>();
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async get(idempotencyKey: string): Promise<ExecutionRecord | null> {
    const record = this.records.get(idempotencyKey);
    return record ? structuredClone(record) : null;
  }

  async claim(seed: ExecutionRecordSeed): Promise<ExecutionRecord | null> {
    return this.runExclusive(() => {
      if (this.records.has(seed.idempotencyKey)) {
        return null;
      }
      const record = newExecutingRecord(seed, this.now().toISOString());
      this.records.set(record.idempotencyKey, record);
      return structuredClone(record);
    });
  }

  async update(record: ExecutionRecord): Promise<void> {
    assertNoPayloadLeak(record);
    await this.runExclusive(() => {
      const next = structuredClone(record);
      next.updatedAt = this.now().toISOString();
      this.records.set(next.idempotencyKey, next);
    });
  }

  private runExclusive<T>(fn: () => T): Promise<T> {
    const result = this.lock.then(fn);
    this.lock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
