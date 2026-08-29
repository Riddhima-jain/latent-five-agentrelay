import type { AgentPermission } from "../domain/capability.js";
import type { AutomationDecision, ProposedAction, ActionRiskMetadata } from "../domain/action.js";
import type { EvidenceStatus } from "../domain/evidence.js";
import { classifyAction } from "./risk-classifier.js";

export interface PolicyEvidence {
  status: EvidenceStatus;
}

export interface PolicyDecision {
  decision: AutomationDecision;
  reasons: string[];
  risk?: ActionRiskMetadata;
}

/** Pure deterministic policy boundary; no runtime, HTTP, or persistence dependency. */
export function decideAutomation(
  action: ProposedAction,
  evidence: readonly PolicyEvidence[],
  agentPermissions: readonly AgentPermission[],
): PolicyDecision {
  const classification = classifyAction(action);
  if (!classification.registered || classification.risk === undefined) {
    return { decision: "DENY", reasons: ["Action type is not registered"] };
  }

  const risk = classification.risk;
  if (risk.prohibited) {
    return { decision: "DENY", risk, reasons: ["Action is prohibited by the server-side registry"] };
  }
  if (!agentPermissions.includes(risk.requiredPermission)) {
    return { decision: "DENY", risk, reasons: ["Agent lacks the required permission"] };
  }
  if (!evidence.some((record) => record.status === "accepted")) {
    return { decision: "RECOMMEND_ONLY", risk, reasons: ["No accepted evidence supports automation"] };
  }
  if (risk.impact === "high" || risk.impact === "critical") {
    return { decision: "RECOMMEND_ONLY", risk, reasons: ["High-impact actions cannot execute automatically"] };
  }
  if (risk.targetScope === "external" || risk.targetScope === "protected") {
    return { decision: "REQUIRE_APPROVAL", risk, reasons: ["External or protected action requires human approval"] };
  }
  return { decision: "AUTO_EXECUTE", risk, reasons: ["Low-impact internal action with accepted evidence"] };
}
