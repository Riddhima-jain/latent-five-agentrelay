import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../domain/evidence.js";
import type { AgentTask } from "../domain/task.js";
import { applyEvidenceAcceptance, assessEvidence } from "./evidence-acceptance.js";

const task: AgentTask = {
  id: "research", sessionId: "workflow-1", title: "Research", requiredCapability: "market_research", requiredPermissions: ["read"],
  dependsOn: [], status: "completed", assignedAgentId: "research-agent", attempt: 1, maxAttempts: 2,
  createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
};
const record: EvidenceRecord = {
  id: "evidence-1", sessionId: "workflow-1", taskId: "research", producerAgentId: "research-agent", status: "provisional",
  claim: "Competitor discounting increased", sourceRefs: ["fixture://market-report.json"], createdAt: "2026-08-29T00:00:00.000Z",
};

describe("evidence acceptance", () => {
  it("accepts evidence only after a matching successful task with provenance", () => {
    expect(assessEvidence(record, task)).toEqual({ status: "accepted", reasons: [] });
    expect(applyEvidenceAcceptance(record, task).status).toBe("accepted");
  });

  it("rejects evidence from the wrong producer or without source provenance", () => {
    expect(assessEvidence({ ...record, producerAgentId: "other-agent", sourceRefs: [] }, task)).toEqual({
      status: "rejected",
      reasons: [
        "Evidence producer does not match the assigned agent",
        "Evidence requires at least one valid source reference",
      ],
    });
  });

  it("rejects evidence from failed or unrelated tasks", () => {
    expect(assessEvidence({ ...record, taskId: "unrelated" }, { ...task, status: "failed" })).toEqual({
      status: "rejected",
      reasons: [
        "Evidence does not belong to the producer task",
        "Producer task did not complete successfully",
      ],
    });
  });
});
