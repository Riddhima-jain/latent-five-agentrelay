import { z } from "zod";
import type { AgentExecutionResult } from "../domain/task.js";

const nonEmptyText = z.string().trim().min(1);

const evidenceSchema = z.object({
  claim: nonEmptyText,
  sourceRefs: z.array(nonEmptyText),
}).strict();

const proposedActionSchema = z.object({
  type: nonEmptyText,
  target: nonEmptyText,
  payload: z.unknown(),
  rationale: nonEmptyText.optional(),
}).strict();

/** The complete untrusted Agent -> Middleware contract. Partial results never escape this boundary. */
export const agentExecutionResultSchema = z.object({
  summary: nonEmptyText,
  evidence: z.array(evidenceSchema),
  proposedActions: z.array(proposedActionSchema),
}).strict();

export type AgentResultValidation =
  | { valid: true; result: AgentExecutionResult }
  | { valid: false; code: "AGENT_RESULT_INVALID"; issues: string[] };

export function validateAgentExecutionResult(value: unknown): AgentResultValidation {
  const parsed = agentExecutionResultSchema.safeParse(value);
  if (parsed.success) {
    const result: AgentExecutionResult = {
      summary: parsed.data.summary,
      evidence: parsed.data.evidence.map((evidence) => ({ ...evidence, sourceRefs: [...evidence.sourceRefs] })),
      proposedActions: parsed.data.proposedActions.map(({ rationale, ...action }) =>
        rationale === undefined ? action : { ...action, rationale },
      ),
    };
    return { valid: true, result };
  }
  return {
    valid: false,
    code: "AGENT_RESULT_INVALID",
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "result"}: ${issue.message}`),
  };
}
