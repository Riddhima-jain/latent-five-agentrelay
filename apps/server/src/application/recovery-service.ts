import type { ActionResult, ApprovedAction } from "../domain/action.js";
import type { ExternalActionExecutor } from "../domain/ports.js";
import type { ExecutionOutcome } from "./execution-ports.js";
import {
  ActionValidationError,
  ProtectedServiceAuthError,
  TransientExecutionError,
} from "./execution-errors.js";

export interface RecoveryOptions {
  executor: ExternalActionExecutor;
  maxAttempts: number;
  timeoutMs: number;
  /** Fixed inter-attempt delay. 0 in tests (plan KTD5 — no backoff in P0). */
  delayMs?: number | undefined;
  /** Called with the just-failed attempt number before the next attempt. Awaited so
   * a `retry.scheduled` trace event is ordered before the terminal event. */
  onRetry?: ((attempt: number) => void | Promise<void>) | undefined;
}

/**
 * Runs one protected execution with a timeout and bounded retries (plan U7).
 * Classifies purely by the error type the executor throws (plan KTD5):
 * `TransientExecutionError` (incl. timeout) retries; `ProtectedServiceAuthError`
 * and `ActionValidationError` are terminal; anything else fails closed.
 */
export class RecoveryService {
  async run(action: ApprovedAction, options: RecoveryOptions): Promise<ExecutionOutcome> {
    const { executor, maxAttempts, timeoutMs } = options;
    const delayMs = options.delayMs ?? 0;
    let lastReason = "no attempts made";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.attempt(executor, action, timeoutMs);
        return { result, terminal: false };
      } catch (error) {
        if (
          error instanceof ProtectedServiceAuthError ||
          error instanceof ActionValidationError
        ) {
          return this.terminal(error.name + ": " + error.message);
        }
        if (!(error instanceof TransientExecutionError)) {
          // Unknown failure — fail closed rather than retry indefinitely.
          return this.terminal("UNKNOWN_EXECUTION_ERROR: " + (error as Error).message);
        }
        lastReason = "TransientExecutionError: " + error.message;
        if (attempt < maxAttempts) {
          await options.onRetry?.(attempt);
          if (delayMs > 0) {
            await sleep(delayMs);
          }
        }
      }
    }

    return this.terminal(`retries exhausted after ${maxAttempts} attempts (${lastReason})`);
  }

  private async attempt(
    executor: ExternalActionExecutor,
    action: ApprovedAction,
    timeoutMs: number,
  ): Promise<ActionResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TransientExecutionError(`attempt timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    // The in-process executor cannot be aborted, so a timed-out attempt is
    // abandoned. Attach a no-op catch so a late rejection from the orphaned
    // call never surfaces as an unhandledRejection. (A real executor should
    // additionally take an AbortSignal — tracked as a follow-up.)
    const attempt = executor.execute(action);
    attempt.catch(() => undefined);
    try {
      return await Promise.race([attempt, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private terminal(reason: string): ExecutionOutcome {
    return { result: { status: "failed", error: reason }, terminal: true, reason };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
