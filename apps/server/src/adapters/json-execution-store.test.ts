import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutionRecord } from "../application/execution-ports.js";
import { JsonExecutionStore } from "./json-execution-store.js";

const now = () => new Date("2026-08-29T12:00:00.000Z");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const newStore = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "exec-store-test-"));
  dirs.push(dir);
  const file = path.join(dir, "executions.json");
  const store = new JsonExecutionStore(file);
  await store.initialize();
  return { store, file };
};

const seed = (key = "session-1|action-1|hash-1") => ({
  idempotencyKey: key,
  sessionId: "session-1",
  actionId: "action-1",
  payloadHash: "hash-1",
});

describe("JsonExecutionStore", () => {
  it("claims a fresh key and reads it back within the same instance", async () => {
    const { store } = await newStore();
    await store.claim(seed());
    expect((await store.get(seed().idempotencyKey))?.status).toBe("executing");
  });

  it("reclaims an executing record left by an interrupted process on reopen", async () => {
    const { store, file } = await newStore();
    await store.claim(seed());
    const reopened = new JsonExecutionStore(file, now);
    await reopened.initialize();
    const record = await reopened.get(seed().idempotencyKey);
    expect(record?.status).toBe("failed");
    expect(record?.result).toEqual({ status: "failed", error: "RECLAIMED_AFTER_INTERRUPT" });
  });

  it("leaves a succeeded record untouched on reopen", async () => {
    const { store, file } = await newStore();
    const claimed = (await store.claim(seed())) as ExecutionRecord;
    await store.update({ ...claimed, status: "succeeded", result: { status: "succeeded", externalReference: "msg-1" } });
    const reopened = new JsonExecutionStore(file);
    await reopened.initialize();
    expect((await reopened.get(seed().idempotencyKey))?.status).toBe("succeeded");
  });

  it("rejects a ledger whose records value is null or an array", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "exec-store-bad-"));
    dirs.push(dir);
    const file = path.join(dir, "executions.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify({ version: 1, records: null }));
    await expect(new JsonExecutionStore(file).initialize()).rejects.toThrow(/Unsupported/);
    await writeFile(file, JSON.stringify({ version: 1, records: [] }));
    await expect(new JsonExecutionStore(file).initialize()).rejects.toThrow(/Unsupported/);
  });

  it("returns null for a second claim on the same key", async () => {
    const { store } = await newStore();
    await store.claim(seed());
    expect(await store.claim(seed())).toBeNull();
  });

  it("is single-winner under 10 concurrent claims", async () => {
    const { store } = await newStore();
    const results = await Promise.all(Array.from({ length: 10 }, () => store.claim(seed())));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("persists an update to succeeded across a fresh instance", async () => {
    const { store, file } = await newStore();
    const claimed = (await store.claim(seed())) as ExecutionRecord;
    await store.update({
      ...claimed,
      status: "succeeded",
      result: { status: "succeeded", externalReference: "msg-1" },
    });
    const reopened = new JsonExecutionStore(file);
    await reopened.initialize();
    expect((await reopened.get(claimed.idempotencyKey))?.status).toBe("succeeded");
  });

  it("does not publish a mutation in memory when persistence fails", async () => {
    const { store } = await newStore();
    const mutable = store as unknown as { filePath: string };
    mutable.filePath = path.join(tmpdir(), "exec-store-missing-dir", "executions.json");
    await expect(store.claim(seed())).rejects.toThrow();
    mutable.filePath = "";
    expect(await store.get(seed().idempotencyKey)).toBeNull();
  });

  it("keeps no payload fields on disk after a full lifecycle (R13)", async () => {
    const { store, file } = await newStore();
    const claimed = (await store.claim(seed())) as ExecutionRecord;
    await store.update({
      ...claimed,
      status: "succeeded",
      result: { status: "succeeded", externalReference: "msg-1" },
    });
    const onDisk = await readFile(file, "utf8");
    for (const field of ["recipient", "subject", "\"body\"", "customer@example.com"]) {
      expect(onDisk).not.toContain(field);
    }
  });
});
