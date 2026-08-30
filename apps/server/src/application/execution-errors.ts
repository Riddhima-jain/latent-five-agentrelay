/**
 * Person 4 error taxonomy for the protected execution path.
 *
 * `recovery-service` classifies purely by which of these is thrown:
 * - `ProtectedServiceAuthError` / `ActionValidationError` are terminal (never retried).
 * - `TransientExecutionError` is retryable up to `maxAttempts`.
 *
 * `ProtectedServiceAuthError` is colocated here rather than added to the Layer 1
 * `errors.ts` (plan U2 sanctioned either; this keeps the executor boundary in
 * Person-4-owned files and avoids touching a shared module).
 */

/** The protected service rejected the caller: missing, empty, or wrong executor token. */
export class ProtectedServiceAuthError extends Error {
  readonly statusCode = 403 as const;

  constructor(message = "Protected service rejected the request: invalid executor token") {
    super(message);
    this.name = "ProtectedServiceAuthError";
  }
}

/** The proposed action failed structural validation. Terminal — never partially acted on. */
export class ActionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionValidationError";
  }
}

/** A transient failure of the external call (timeout, service transient error). Retryable. */
export class TransientExecutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransientExecutionError";
  }
}
