import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApprovedAction } from "../domain/action.js";
import type { ApprovalRecord } from "../domain/approval.js";
import { payloadHashFor } from "./approval-service.js";
import { RelayApprovalVerifier } from "./relay-approval-verifier.js";
import { RelayJsonStore } from "./relay-store.js";

async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentrelay-verifier-"));
  const store = new RelayJsonStore(path.join(root, "relay.json"));
  await store.initialize();
  const proposed = {
    id: "a1", sessionId: "s1", taskId: "outreach", producerAgentId: "outreach-agent",
    type: "SEND_EMAIL", target: "customer@example.com",
    payload: { recipient: "customer@example.com", subject: "Recovery", body: "Hello" },
    createdAt: "2026-01-01T00:00:00Z",
  };
  const payloadHash = payloadHashFor(proposed);
  const action: ApprovedAction = { ...proposed, payloadHash, idempotencyKey: `s1|a1|${payloadHash}` };
  const verifier = new RelayApprovalVerifier(store);
  const saveApproval = (overrides: Partial<ApprovalRecord>) => store.saveApproval({
    id: "approval-a1", actionId: "a1", sessionId: "s1", payloadHash, status: "approved",
    createdAt: "2026-01-01T00:00:00Z", ...overrides,
  });
  return { store, action, verifier, saveApproval, payloadHash };
}

describe("RelayApprovalVerifier", () => {
  it("passes when the approval is approved and the hash matches", async () => {
    const { action, verifier, saveApproval } = await harness();
    await saveApproval({ status: "approved" });
    expect(await verifier.isSatisfied(action)).toEqual({ ok: true });
  });

  it("fails closed when no approval record exists", async () => {
    const { action, verifier } = await harness();
    expect(await verifier.isSatisfied(action)).toEqual({ ok: false, reason: "NO_APPROVAL" });
  });

  it("reports a pending approval as NO_APPROVAL", async () => {
    const { action, verifier, saveApproval } = await harness();
    await saveApproval({ status: "pending" });
    expect(await verifier.isSatisfied(action)).toEqual({ ok: false, reason: "NO_APPROVAL" });
  });

  it("reports a denied approval as APPROVAL_DENIED", async () => {
    const { action, verifier, saveApproval } = await harness();
    await saveApproval({ status: "denied" });
    expect(await verifier.isSatisfied(action)).toEqual({ ok: false, reason: "APPROVAL_DENIED" });
  });

  it("reports an invalidated approval as APPROVAL_INVALIDATED", async () => {
    const { action, verifier, saveApproval } = await harness();
    await saveApproval({ status: "invalidated" });
    expect(await verifier.isSatisfied(action)).toEqual({ ok: false, reason: "APPROVAL_INVALIDATED" });
  });

  it("reports HASH_MISMATCH when the action payload changed after approval", async () => {
    const { action, verifier, saveApproval } = await harness();
    await saveApproval({ status: "approved" });
    const tampered: ApprovedAction = { ...action, payload: { ...(action.payload as object), recipient: "attacker@example.com" } };
    expect(await verifier.isSatisfied(tampered)).toEqual({ ok: false, reason: "HASH_MISMATCH" });
  });

  it("reports HASH_MISMATCH when the carried action.payloadHash is stale but the stored approval hash is current", async () => {
    const { action, verifier, saveApproval } = await harness();
    await saveApproval({ status: "approved" });
    const stale: ApprovedAction = { ...action, payloadHash: "0".repeat(64) };
    expect(await verifier.isSatisfied(stale)).toEqual({ ok: false, reason: "HASH_MISMATCH" });
  });
});
