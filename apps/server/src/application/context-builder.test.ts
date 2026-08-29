import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../domain/evidence.js";
import type { AgentTask } from "../domain/task.js";
import { buildContextCapsule } from "./context-builder.js";

const strategy: AgentTask = {
  id: "strategy", sessionId: "workflow-1", title: "Strategy", requiredCapability: "strategy", requiredPermissions: ["read"],
  dependsOn: ["research", "finance"], status: "ready", attempt: 0, maxAttempts: 2,
  createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
};
function evidence(id: string, taskId: string, status: EvidenceRecord["status"], sessionId = "workflow-1"): EvidenceRecord {
  return { id, sessionId, taskId, producerAgentId: `${taskId}-agent`, status, claim: id, sourceRefs: [`fixture://${id}`], createdAt: "2026-08-29T00:00:00.000Z" };
}

describe("buildContextCapsule", () => {
  it("includes only accepted evidence from declared dependencies and preserves provenance", () => {
    const capsule = buildContextCapsule({
      sessionId: "workflow-1", goal: "Recover sales", currentTask: strategy, constraints: ["No discount over 10%"], allowedResources: ["fixture://market-report.json"],
      evidence: [
        evidence("research-ok", "research", "accepted"), evidence("finance-ok", "finance", "accepted"),
        evidence("outreach-unrelated", "outreach", "accepted"), evidence("research-rejected", "research", "rejected"),
        evidence("finance-stale", "finance", "stale"), evidence("other-session", "research", "accepted", "workflow-2"),
      ],
    });
    expect(capsule.dependencyEvidence.map((record) => record.id)).toEqual(["research-ok", "finance-ok"]);
    expect(capsule.dependencyEvidence[0]?.sourceRefs).toEqual(["fixture://research-ok"]);
    expect(capsule.constraints).toEqual(["No discount over 10%"]);
  });
});
