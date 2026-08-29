import { describe, expect, it } from "vitest";
import type { ProposedAction } from "../domain/action.js";
import { decideAutomation } from "./automation-decision-service.js";

function action(type: string): ProposedAction {
  return {
    id: "action-1", sessionId: "session-1", taskId: "task-1", producerAgentId: "agent-1",
    type, target: "customer-a", payload: { subject: "hello" }, createdAt: "2026-08-29T00:00:00.000Z",
  };
}

describe("decideAutomation", () => {
  const acceptedEvidence = [{ status: "accepted" as const }];

  it("auto-executes a low-impact internal draft", () => {
    expect(decideAutomation(action("CREATE_INTERNAL_DRAFT"), acceptedEvidence, ["internal_write"]).decision)
      .toBe("AUTO_EXECUTE");
  });

  it("requires approval for an external email", () => {
    expect(decideAutomation(action("SEND_EMAIL"), acceptedEvidence, ["external_write"]).decision)
      .toBe("REQUIRE_APPROVAL");
  });

  it("keeps high-impact pricing changes recommendation-only", () => {
    expect(decideAutomation(action("UPDATE_PRICING"), acceptedEvidence, ["external_write"]).decision)
      .toBe("RECOMMEND_ONLY");
  });

  it("hard-denies protected-data deletion", () => {
    expect(decideAutomation(action("DELETE_PROTECTED_DATA"), acceptedEvidence, ["destructive"]).decision)
      .toBe("DENY");
  });

  it("ignores an agent claim that an external action has low impact", () => {
    const spoofed = Object.assign(action("SEND_EMAIL"), { impact: "low", prohibited: false });
    const decision = decideAutomation(spoofed, acceptedEvidence, ["external_write"]);

    expect(decision.decision).toBe("REQUIRE_APPROVAL");
    expect(decision.risk?.targetScope).toBe("external");
  });

  it("does not automate without accepted evidence", () => {
    expect(decideAutomation(action("CREATE_INTERNAL_DRAFT"), [{ status: "provisional" }], ["internal_write"]).decision)
      .toBe("RECOMMEND_ONLY");
  });

  it("denies an action when the agent lacks its trusted required permission", () => {
    expect(decideAutomation(action("SEND_EMAIL"), acceptedEvidence, ["read"]).decision)
      .toBe("DENY");
  });
});
