import { createHash } from "node:crypto";
import type { ApprovedAction } from "../../domain/action.js";
import { PROTECTED_ACTION_TYPE, type SendEmailPayload } from "../../domain/protected-action.js";

/** Mirrors Person 3's `hash(type + target + canonicalJson(payload))` (plan KTD4, OQ2). */
export function actionHash(type: string, target: string, payload: unknown): string {
  return createHash("sha256")
    .update(`${type}\n${target}\n${JSON.stringify(payload)}`)
    .digest("hex");
}

export function approvedEmailAction(overrides: Partial<ApprovedAction> = {}): ApprovedAction {
  const payload: SendEmailPayload = {
    recipient: "customer@example.com",
    subject: "We want you back",
    body: "Here is a discount to win you back.",
  };
  const target = payload.recipient;
  const base: ApprovedAction = {
    id: "action-1",
    sessionId: "session-1",
    taskId: "outreach",
    producerAgentId: "outreach-agent",
    type: PROTECTED_ACTION_TYPE,
    target,
    payload,
    rationale: "Customers churned; re-engage.",
    createdAt: "2026-08-29T12:00:00.000Z",
    payloadHash: actionHash(PROTECTED_ACTION_TYPE, target, payload),
    idempotencyKey: "",
  };
  const merged = { ...base, ...overrides };
  merged.idempotencyKey =
    overrides.idempotencyKey ??
    `${merged.sessionId}|${merged.id}|${merged.payloadHash}`;
  return merged;
}
