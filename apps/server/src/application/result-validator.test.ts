import { describe, expect, it } from "vitest";
import { validateAgentExecutionResult } from "./result-validator.js";

describe("validateAgentExecutionResult", () => {
  it("accepts a complete structured Agent result", () => {
    expect(validateAgentExecutionResult({
      summary: "Market demand weakened.",
      evidence: [{ claim: "Competitor discounting increased", sourceRefs: ["fixture://market-report.json"] }],
      proposedActions: [{ type: "SEND_EMAIL", target: "customer-a", payload: { body: "Hello" } }],
    })).toMatchObject({ valid: true });
  });

  it("rejects malformed results as AGENT_RESULT_INVALID without returning a partial result", () => {
    const result = validateAgentExecutionResult({
      summary: "Looks plausible",
      evidence: [{ claim: "Missing sources", sourceRefs: "fixture://market-report.json" }],
      proposedActions: [],
    });
    expect(result).toMatchObject({ valid: false, code: "AGENT_RESULT_INVALID" });
    expect("result" in result).toBe(false);
  });

  it("rejects untrusted policy metadata instead of allowing it into the contract", () => {
    expect(validateAgentExecutionResult({
      summary: "Send a message",
      evidence: [],
      proposedActions: [{ type: "SEND_EMAIL", target: "customer-a", payload: {}, impact: "low" }],
    })).toMatchObject({ valid: false, code: "AGENT_RESULT_INVALID" });
  });

  it("rejects a result when any required contract field is missing", () => {
    expect(validateAgentExecutionResult({
      summary: "Incomplete result",
      evidence: [],
      // proposedActions deliberately omitted
    })).toMatchObject({ valid: false, code: "AGENT_RESULT_INVALID" });
  });
});
