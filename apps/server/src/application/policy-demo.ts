import assert from "node:assert/strict";
import type { ProposedAction } from "../domain/action.js";
import { InMemoryApprovalService } from "./approval-service.js";
import { decideAutomation, type PolicyAgent } from "./automation-decision-service.js";

const acceptedEvidence = [{ status: "accepted" as const }];

function action(type: string, overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: "action-1",
    sessionId: "session-1",
    taskId: "outreach",
    producerAgentId: "outreach-agent",
    type,
    target: "customer-a",
    payload: { subject: "Recovery plan", body: "Hello" },
    createdAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function agent(permissions: PolicyAgent["permissions"], registered = true): PolicyAgent {
  return { agentId: "outreach-agent", registered, permissions };
}

function demonstrateDay1(): void {
  assert.equal(decideAutomation(action("CREATE_INTERNAL_DRAFT"), acceptedEvidence, agent(["internal_write"])).decision, "AUTO_EXECUTE");
  assert.equal(decideAutomation(action("SEND_EMAIL"), acceptedEvidence, agent(["external_write"])).decision, "REQUIRE_APPROVAL");
  assert.equal(decideAutomation(action("UPDATE_PRICING"), acceptedEvidence, agent(["external_write"])).decision, "RECOMMEND_ONLY");
  assert.equal(decideAutomation(action("DELETE_PROTECTED_DATA"), acceptedEvidence, agent(["destructive"])).decision, "DENY");
  console.log("PASS P3 Day 1: all four deterministic automation decisions");
}

function demonstrateDay2(): void {
  const service = new InMemoryApprovalService(() => "2026-08-29T01:00:00.000Z");
  const email = action("SEND_EMAIL");
  assert.equal(decideAutomation(email, acceptedEvidence, agent(["external_write"])).decision, "REQUIRE_APPROVAL");
  assert.equal(service.registerAction(email).status, "pending");
  assert.equal(service.authorize(email).executable, false);
  assert.equal(service.approveAction(email.id).status, "approved");
  assert.equal(service.authorize(email).executable, true);
  assert.deepEqual(service.authorize(action("SEND_EMAIL", { target: "customer-b" })), {
    executable: false,
    reason: "APPROVAL_INVALIDATED",
    approval: service.getApproval(email.id),
  });
  console.log("PASS P3 Day 2: email approval is payload-bound and mutation invalidates it");
}

function demonstrateDay3(): void {
  assert.equal(decideAutomation(action("SEND_EMAIL"), acceptedEvidence, agent(["external_write"], false)).decision, "DENY");
  assert.equal(decideAutomation(action("SEND_EMAIL"), acceptedEvidence, agent(["read"])).decision, "DENY");
  assert.equal(decideAutomation(action("CREATE_INTERNAL_DRAFT"), [{ status: "accepted" }, { status: "rejected" }], agent(["internal_write"])).decision, "RECOMMEND_ONLY");
  const forgedRiskClaim = Object.assign(action("SEND_EMAIL"), { impact: "low", prohibited: false });
  assert.equal(decideAutomation(forgedRiskClaim, acceptedEvidence, agent(["external_write"])).decision, "REQUIRE_APPROVAL");
  console.log("PASS P3 Day 3: unregistered/under-permitted agents are denied; conflicting evidence abstains; risk spoofing fails");
}

demonstrateDay1();
demonstrateDay2();
demonstrateDay3();
console.log("\nPASS: P3 policy and approval exit criteria are satisfied with in-memory fixtures.");
