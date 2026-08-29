import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RelayJsonStore } from "./relay-store.js";

describe("RelayJsonStore", () => {
  it("recovers sessions, trace, and approvals after restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentrelay-store-"));
    const file = path.join(root, "relay.json");
    const first = new RelayJsonStore(file);
    await first.initialize();
    await first.save({ id: "s1", goal: "test", traceId: "t1", participantAgentIds: [], status: "running", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    await first.append({ id: "e1", traceId: "t1", sessionId: "s1", type: "session.created", timestamp: "2026-01-01T00:00:00Z" });
    await first.saveApproval({ id: "p1", actionId: "a1", payloadHash: "hash", sessionId: "s1", status: "pending", createdAt: "2026-01-01T00:00:00Z" });

    const restarted = new RelayJsonStore(file);
    await restarted.initialize();
    expect((await restarted.get("s1"))?.traceId).toBe("t1");
    expect(await restarted.listTrace("s1")).toHaveLength(1);
    expect((await restarted.getApproval("p1"))?.status).toBe("pending");
  });
});
