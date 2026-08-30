import { describe, expect, it } from "vitest";
import type { ExecutionRecord } from "../application/execution-ports.js";
import { InMemoryExecutionStore } from "./in-memory-execution-store.js";

const seed = (key = "session-1|action-1|hash-1") => ({
  idempotencyKey: key,
  sessionId: "session-1",
  actionId: "action-1",
  payloadHash: "hash-1",
});

describe("InMemoryExecutionStore", () => {
  it("claims a fresh key into executing and returns it from get", async () => {
    const store = new InMemoryExecutionStore();
    const claimed = await store.claim(seed());
    expect(claimed?.status).toBe("executing");
    expect((await store.get(seed().idempotencyKey))?.status).toBe("executing");
  });

  it("returns null for a second claim and does not reset the record", async () => {
    const store = new InMemoryExecutionStore();
    await store.claim(seed());
    expect(await store.claim(seed())).toBeNull();
    expect((await store.get(seed().idempotencyKey))?.status).toBe("executing");
  });

  it("is single-winner under 10 concurrent claims", async () => {
    const store = new InMemoryExecutionStore();
    const results = await Promise.all(Array.from({ length: 10 }, () => store.claim(seed())));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("persists an update to succeeded", async () => {
    const store = new InMemoryExecutionStore();
    const claimed = (await store.claim(seed())) as ExecutionRecord;
    await store.update({ ...claimed, status: "succeeded", result: { status: "succeeded", externalReference: "msg-1" } });
    expect((await store.get(claimed.idempotencyKey))?.status).toBe("succeeded");
  });

  it("rejects an update whose result carries a non-ActionResult field (R13)", async () => {
    const store = new InMemoryExecutionStore();
    const claimed = (await store.claim(seed())) as ExecutionRecord;
    await expect(
      store.update({
        ...claimed,
        result: { status: "succeeded", body: "leaked" } as never,
      }),
    ).rejects.toThrow(/R13/);
  });
});
