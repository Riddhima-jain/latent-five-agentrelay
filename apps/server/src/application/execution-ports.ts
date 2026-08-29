import type { ActionResult, ApprovedAction, AutomationDecision } from "../domain/action.js";

/**
 * Person-4-owned contracts for the protected execution path (plan KTD2).
 * These extend the frozen `domain/` set and are proposed to the team on Day 1;
 * they move into `domain/ports.ts` only on team agreement.
 */

/**
 * Verifies that a valid, payload-bound approval exists for an action that requires one.
 * Only consulted for `REQUIRE_APPROVAL` actions (plan KTD9).
 */
export interface ApprovalVerifier {
  isSatisfied(
    action: ApprovedAction,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: "NO_APPROVAL" | "APPROVAL_DENIED" | "APPROVAL_INVALIDATED" | "HASH_MISMATCH";
      }
  >;
}

export type ExecutionRecordStatus = "pending" | "executing" | "succeeded" | "failed";

/** The idempotency ledger row. Persists `payloadHash` only, never payload fields (plan R13). */
export interface ExecutionRecord {
  /** `sessionId + "|" + actionId + "|" + payloadHash` */
  idempotencyKey: string;
  sessionId: string;
  actionId: string;
  payloadHash: string;
  status: ExecutionRecordStatus;
  attempts: number;
  /** Present once terminal. `ActionResult` only — no payload, no token. */
  result?: ActionResult | undefined;
  createdAt: string;
  updatedAt: string;
}

/** The fields a caller supplies to open a claim; the store fills status/attempts/timestamps. */
export type ExecutionRecordSeed = Pick<
  ExecutionRecord,
  "idempotencyKey" | "sessionId" | "actionId" | "payloadHash"
>;

export interface ExecutionStore {
  get(idempotencyKey: string): Promise<ExecutionRecord | null>;
  /**
   * Atomic compare-and-set: create-or-claim into `executing`. Returns the claimed
   * record, or `null` when a record for the key already exists (the caller then
   * reads the existing record). Never mutates an existing record.
   */
  claim(seed: ExecutionRecordSeed): Promise<ExecutionRecord | null>;
  update(record: ExecutionRecord): Promise<void>;
}

/**
 * The Coordinator-facing return of `ExecutionService.run` (plan KTD10).
 * `domain/action.ts` `ActionResult` is frozen with no metadata channel, so the
 * "keep downstream blocked" signal rides here instead.
 */
export interface ExecutionOutcome {
  result: ActionResult;
  /** `true` => a terminal failure the Coordinator uses to keep downstream tasks blocked. */
  terminal: boolean;
  reason?: string | undefined;
}

export interface ExecutionService {
  /**
   * Idempotent, retrying, approval-enforced execution of a cleared action.
   * `decision` is `AUTO_EXECUTE` (skip approval lookup) or `REQUIRE_APPROVAL`
   * (require a valid payload-bound approval). `DENY` / `RECOMMEND_ONLY` never
   * reach Person 4 and are a caller-contract violation.
   */
  run(action: ApprovedAction, decision: AutomationDecision): Promise<ExecutionOutcome>;
}
