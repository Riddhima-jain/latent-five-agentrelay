import { createHash } from "node:crypto";
import type { ProposedAction } from "../domain/action.js";
import type { ApprovalRecord } from "../domain/approval.js";

export type ApprovalAuthorization =
  | { executable: true; approval: ApprovalRecord }
  | { executable: false; reason: "APPROVAL_REQUIRED" | "APPROVAL_DENIED" | "APPROVAL_INVALIDATED"; approval?: ApprovalRecord };

export interface ApprovalService {
  registerAction(action: ProposedAction): ApprovalRecord;
  approveAction(actionId: string): ApprovalRecord;
  denyAction(actionId: string): ApprovalRecord;
  getApproval(actionId: string): ApprovalRecord | undefined;
  authorize(action: ProposedAction): ApprovalAuthorization;
}

/**
 * In-memory Day-2 approval state machine. The approval hash includes the action
 * type and target as well as its JSON payload, so changing a recipient cannot
 * reuse an approval even when an action id is retained.
 */
export class InMemoryApprovalService implements ApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  registerAction(action: ProposedAction): ApprovalRecord {
    const existing = this.approvals.get(action.id);
    if (existing !== undefined) return { ...existing };

    const record: ApprovalRecord = {
      id: `approval-${action.id}`,
      actionId: action.id,
      payloadHash: payloadHashFor(action),
      sessionId: action.sessionId,
      status: "pending",
      createdAt: this.now(),
    };
    this.approvals.set(action.id, record);
    return { ...record };
  }

  approveAction(actionId: string): ApprovalRecord {
    const record = this.requirePending(actionId);
    const approved = { ...record, status: "approved" as const, approvedAt: this.now() };
    this.approvals.set(actionId, approved);
    return { ...approved };
  }

  denyAction(actionId: string): ApprovalRecord {
    const record = this.requirePending(actionId);
    const denied = { ...record, status: "denied" as const, deniedAt: this.now() };
    this.approvals.set(actionId, denied);
    return { ...denied };
  }

  getApproval(actionId: string): ApprovalRecord | undefined {
    const record = this.approvals.get(actionId);
    return record === undefined ? undefined : { ...record };
  }

  authorize(action: ProposedAction): ApprovalAuthorization {
    const record = this.approvals.get(action.id);
    if (record === undefined) return { executable: false, reason: "APPROVAL_REQUIRED" };
    if (record.status === "pending") return { executable: false, reason: "APPROVAL_REQUIRED", approval: { ...record } };
    if (record.status === "denied") return { executable: false, reason: "APPROVAL_DENIED", approval: { ...record } };
    if (record.status === "invalidated") return { executable: false, reason: "APPROVAL_INVALIDATED", approval: { ...record } };

    if (record.payloadHash !== payloadHashFor(action)) {
      const invalidated = { ...record, status: "invalidated" as const, invalidatedAt: this.now() };
      this.approvals.set(action.id, invalidated);
      return { executable: false, reason: "APPROVAL_INVALIDATED", approval: { ...invalidated } };
    }
    return { executable: true, approval: { ...record } };
  }

  private requirePending(actionId: string): ApprovalRecord {
    const record = this.approvals.get(actionId);
    if (record === undefined) throw new Error(`Unknown action: ${actionId}`);
    if (record.status !== "pending") throw new Error(`Action ${actionId} approval is already ${record.status}`);
    return record;
  }
}

/** Stable across JSON object property order; unsupported values fail closed. */
export function payloadHashFor(action: Pick<ProposedAction, "type" | "target" | "payload">): string {
  const canonical = canonicalJson({ type: action.type, target: action.target, payload: action.payload });
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Action payload must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new TypeError("Action payload must be JSON-serializable");
}
