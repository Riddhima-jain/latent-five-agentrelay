import { randomUUID } from "node:crypto";
import type { ActionResult, ApprovedAction, AutomationDecision } from "../domain/action.js";
import type { ExternalActionExecutor, TraceSink } from "../domain/ports.js";
import { PROTECTED_ACTION_TYPE } from "../domain/protected-action.js";
import type { TraceEvent, TraceEventType } from "../domain/trace.js";
import { scrubSecrets, summarizePayload } from "./redact-trace.js";
import type {
  ApprovalVerifier,
  ExecutionOutcome,
  ExecutionService as ExecutionServicePort,
  ExecutionStore,
} from "./execution-ports.js";
import type { RecoveryService } from "./recovery-service.js";

export interface ExecutionServiceDeps {
  verifier: ApprovalVerifier;
  store: ExecutionStore;
  executor: ExternalActionExecutor;
  recovery: RecoveryService;
  sink: TraceSink;
  traceId: string;
  /** Secrets scrubbed from every trace metadata payload and every persisted result (defense in depth). */
  secrets?: string[] | undefined;
  maxAttempts?: number | undefined;
  timeoutMs?: number | undefined;
  delayMs?: number | undefined;
  now?: (() => Date) | undefined;
}

const inProgress = (): ExecutionOutcome => ({
  result: { status: "executing" },
  terminal: false,
});

/**
 * The public surface Persons 1/5 call (plan U6). Enforces the approval decision,
 * runs the atomic idempotency guard, delegates the retry loop, and emits
 * redacted trace events. Returns `ExecutionOutcome` (KTD10).
 */
export class ExecutionService implements ExecutionServicePort {
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly delayMs: number;
  private readonly now: () => Date;
  private readonly secrets: string[];

  constructor(private readonly deps: ExecutionServiceDeps) {
    this.maxAttempts = deps.maxAttempts ?? 3;
    this.timeoutMs = deps.timeoutMs ?? 10_000;
    this.delayMs = deps.delayMs ?? 0;
    this.now = deps.now ?? (() => new Date());
    this.secrets = deps.secrets ?? [];
  }

  async run(action: ApprovedAction, decision: AutomationDecision): Promise<ExecutionOutcome> {
    if (decision === "DENY" || decision === "RECOMMEND_ONLY") {
      throw new Error(
        `ExecutionService received a ${decision} action; only AUTO_EXECUTE or approved REQUIRE_APPROVAL actions may reach it`,
      );
    }

    // The boundary independently binds the protected type to approval: the
    // automation decision matrix never yields AUTO_EXECUTE for an external
    // action, so an AUTO_EXECUTE SEND_EMAIL is an upstream misclassification and
    // is refused here rather than executed unapproved (plan R5/R6).
    if (action.type === PROTECTED_ACTION_TYPE && decision === "AUTO_EXECUTE") {
      return this.fail(action, "PROTECTED_ACTION_REQUIRES_APPROVAL");
    }

    const key = `${action.sessionId}|${action.id}|${action.payloadHash}`;
    if (action.idempotencyKey && action.idempotencyKey !== key) {
      return this.fail(action, "IDEMPOTENCY_KEY_MISMATCH");
    }

    if (decision === "REQUIRE_APPROVAL") {
      const verdict = await this.deps.verifier.isSatisfied(action);
      if (!verdict.ok) {
        return this.fail(action, verdict.reason);
      }
    }

    const claimed = await this.deps.store.claim({
      idempotencyKey: key,
      sessionId: action.sessionId,
      actionId: action.id,
      payloadHash: action.payloadHash,
    });

    if (!claimed) {
      const existing = await this.deps.store.get(key);
      if (existing?.status === "succeeded" && existing.result) {
        return { result: existing.result, terminal: false };
      }
      if (existing?.status === "failed") {
        return { result: existing.result ?? { status: "failed" }, terminal: true };
      }
      return inProgress();
    }

    await this.emit(action, "action.execution_started", decision);

    const outcome = await this.deps.recovery.run(action, {
      executor: this.deps.executor,
      maxAttempts: this.maxAttempts,
      timeoutMs: this.timeoutMs,
      delayMs: this.delayMs,
      onRetry: (attempt) => this.emit(action, "retry.scheduled", decision, { attempt }),
    });

    const safeResult = this.redactResult(outcome.result);
    const safeReason = outcome.reason ? this.redactText(outcome.reason) : undefined;

    await this.deps.store.update({
      ...claimed,
      status: outcome.terminal ? "failed" : "succeeded",
      attempts: claimed.attempts + 1,
      result: safeResult,
      updatedAt: this.now().toISOString(),
    });

    await this.emit(
      action,
      outcome.terminal ? "action.failed" : "action.executed",
      decision,
      safeReason ? { reason: safeReason } : undefined,
    );

    return { ...outcome, result: safeResult, reason: safeReason };
  }

  /**
   * P4's boundary emits one unambiguous event when it refuses to execute:
   * `action.failed` with the precise cause in `metadata.reason`. Approval
   * lifecycle events (`approval.granted` / `approval.denied`) belong to Person 3.
   */
  private async fail(action: ApprovedAction, reason: string): Promise<ExecutionOutcome> {
    await this.emit(action, "action.failed", undefined, { reason });
    return { result: { status: "failed", error: reason }, terminal: true, reason };
  }

  /** Redact any secret that reached a free-text `error` value before it is persisted or traced (plan R12/R13). */
  private redactResult(result: ActionResult): ActionResult {
    if (!result.error) {
      return result;
    }
    return { ...result, error: this.redactText(result.error) };
  }

  private redactText(text: string): string {
    return scrubSecrets(text, this.secrets);
  }

  /**
   * Trace emission is best-effort: a `TraceSink` failure is logged to the sink's
   * own error channel where possible but must never abort the execution state
   * machine (a thrown emit between claim and update would wedge the key).
   */
  private async emit(
    action: ApprovedAction,
    type: TraceEventType,
    decision?: AutomationDecision,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const metadata = scrubSecrets(
      {
        actionId: action.id,
        actionType: action.type,
        target: action.target,
        payloadSummary: summarizePayload(action.type, action.payload),
        ...(decision ? { decision } : {}),
        ...(extra ?? {}),
      },
      this.secrets,
    );

    const event: TraceEvent = {
      id: randomUUID(),
      traceId: this.deps.traceId,
      sessionId: action.sessionId,
      taskId: action.taskId,
      agentId: action.producerAgentId,
      type,
      timestamp: this.now().toISOString(),
      metadata,
    };
    try {
      await this.deps.sink.append(event);
    } catch {
      // Swallow: the protected side effect and the idempotency ledger are the
      // source of truth. A dropped trace event is a visibility gap, not a
      // correctness failure, and must not prevent the ledger from reaching a
      // terminal state.
    }
  }
}
