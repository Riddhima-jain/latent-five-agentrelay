/** The sole deterministic protected side effect in the P0 demo. */
export const PROTECTED_ACTION_TYPE = "SEND_EMAIL" as const;
export type ProtectedActionType = typeof PROTECTED_ACTION_TYPE;

/**
 * The complete execution-relevant payload for the protected email mock.
 * This shape is hashed for approval and idempotency; it deliberately contains no credential.
 */
export interface SendEmailPayload {
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Trusted executors may map an approved action into this request.
 * The executor credential must be supplied by the executor's private configuration,
 * never by an agent result, action payload, context capsule, or trace event.
 */
export interface ProtectedEmailRequest {
  sessionId: string;
  actionId: string;
  payload: SendEmailPayload;
}

export interface ProtectedEmailReceipt {
  messageId: string;
  acceptedAt: string;
}
