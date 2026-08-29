import { describe, expect, it } from "vitest";
import type { ProposedAction } from "../domain/action.js";
import { InMemoryApprovalService, payloadHashFor } from "./approval-service.js";

function email(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: "email-1", sessionId: "session-1", taskId: "outreach", producerAgentId: "outreach-agent",
    type: "SEND_EMAIL", target: "customer-a", payload: { subject: "Recovery plan", body: "Hello" },
    createdAt: "2026-08-29T00:00:00.000Z", ...overrides,
  };
}

describe("InMemoryApprovalService", () => {
  it("moves a registered email from PENDING through APPROVED to executable", () => {
    const service = new InMemoryApprovalService(() => "2026-08-29T01:00:00.000Z");
    const proposed = email();

    expect(service.registerAction(proposed).status).toBe("pending");
    expect(service.authorize(proposed)).toMatchObject({ executable: false, reason: "APPROVAL_REQUIRED" });
    expect(service.approveAction(proposed.id)).toMatchObject({ status: "approved", actionId: proposed.id });
    expect(service.authorize(proposed)).toMatchObject({ executable: true, approval: { status: "approved" } });
  });

  it("invalidates an approval when the payload changes", () => {
    const service = new InMemoryApprovalService();
    const proposed = email();
    service.registerAction(proposed);
    service.approveAction(proposed.id);

    expect(service.authorize(email({ payload: { subject: "Changed", body: "Hello" } })))
      .toMatchObject({ executable: false, reason: "APPROVAL_INVALIDATED", approval: { status: "invalidated" } });
    expect(service.getApproval(proposed.id)?.status).toBe("invalidated");
  });

  it("does not authorize a different target with the same action id", () => {
    const service = new InMemoryApprovalService();
    const proposed = email();
    service.registerAction(proposed);
    service.approveAction(proposed.id);

    expect(service.authorize(email({ target: "customer-b" }))).toMatchObject({
      executable: false, reason: "APPROVAL_INVALIDATED",
    });
  });

  it("denies a pending action and prevents it from becoming executable", () => {
    const service = new InMemoryApprovalService();
    const proposed = email();
    service.registerAction(proposed);

    expect(service.denyAction(proposed.id).status).toBe("denied");
    expect(service.authorize(proposed)).toMatchObject({ executable: false, reason: "APPROVAL_DENIED" });
  });

  it("hashes equivalent object payloads identically regardless of key order", () => {
    expect(payloadHashFor(email({ payload: { b: 2, a: 1 } }))).toBe(payloadHashFor(email({ payload: { a: 1, b: 2 } })));
  });

  it("rejects repeated approvals or approvals for unknown actions", () => {
    const service = new InMemoryApprovalService();
    const proposed = email();
    service.registerAction(proposed);
    service.approveAction(proposed.id);

    expect(() => service.approveAction(proposed.id)).toThrow("already approved");
    expect(() => service.denyAction("missing")).toThrow("Unknown action");
  });
});
