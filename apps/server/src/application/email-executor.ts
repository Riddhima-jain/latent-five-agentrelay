import { randomUUID } from "node:crypto";
import type { ApprovedAction, ActionResult } from "../domain/action.js";
import type { ExternalActionExecutor } from "../domain/ports.js";
import type { SendEmailPayload } from "../domain/protected-action.js";
import { MockActionExecutor } from "../adapters/mock-action-executor.js";
import { MockProtectedEmailService } from "../adapters/mock-protected-email-service.js";
import { payloadHashFor } from "./approval-service.js";
import type { RelayActionReceipt, RelayJsonStore } from "./relay-store.js";

export interface EmailExecutorConfig {
  provider: "mock" | "resend";
  /** Pins the mock protected-service credential; empty means a per-boot ephemeral token. Unused by Resend. */
  executorToken: string;
  resendApiKey: string;
  resendFrom: string;
  resendToOverride: string;
}

/**
 * The effective mock protected-service credential: the configured value when it
 * is a real 24+ char token, otherwise a per-boot ephemeral one. The Agent
 * Runtime never receives either; callers add the return value to the trace
 * redaction secrets so it can never surface in a persisted trace or ledger.
 */
export function resolveMockExecutorToken(configured: string): string {
  return configured && configured.length >= 24 && !configured.startsWith("replace-")
    ? configured
    : `mock-executor-${randomUUID()}-${randomUUID()}`;
}

abstract class BaseEmailExecutor implements ExternalActionExecutor {
  constructor(protected readonly store: RelayJsonStore, protected readonly now: () => string = () => new Date().toISOString()) {}

  async execute(action: ApprovedAction): Promise<ActionResult> {
    this.validate(action);
    const existing = await this.store.getReceipt(action.idempotencyKey);
    if (existing) return { status: "succeeded", externalReference: existing.externalReference };
    const receipt = await this.deliver(action, action.payload as SendEmailPayload);
    await this.store.saveReceipt(receipt);
    return { status: "succeeded", externalReference: receipt.externalReference };
  }

  protected abstract deliver(action: ApprovedAction, payload: SendEmailPayload): Promise<RelayActionReceipt>;

  private validate(action: ApprovedAction): void {
    if (action.type !== "SEND_EMAIL") throw new Error(`Unsupported protected action: ${action.type}`);
    if (action.payloadHash !== payloadHashFor(action)) throw new Error("Approved action payload hash does not match its contents");
    const payload = action.payload as Partial<SendEmailPayload>;
    if (!payload.recipient?.trim() || !payload.subject?.trim() || !payload.body?.trim()) throw new Error("SEND_EMAIL payload is incomplete");
    if (!action.idempotencyKey.trim()) throw new Error("Approved action requires an idempotency key");
  }
}

/**
 * Mock delivery routes through the token-gated `MockProtectedEmailService` via
 * the trusted `MockActionExecutor` (the sole token holder), so even the default
 * demo path proves the hard enforcement boundary (plan R1/R4). The receipt the
 * session view renders is derived from the protected service's `messageId`.
 * When no token is pinned, a per-boot ephemeral value is used — the Agent
 * Runtime never receives it, so isolation still holds.
 */
export class MockEmailExecutor extends BaseEmailExecutor {
  private readonly protectedExecutor: MockActionExecutor;

  constructor(
    store: RelayJsonStore,
    options: { token?: string | undefined; service?: MockProtectedEmailService | undefined } = {},
    now?: () => string,
  ) {
    super(store, now);
    const token = resolveMockExecutorToken(options.token ?? "");
    const service = options.service ?? new MockProtectedEmailService({ expectedToken: token });
    this.protectedExecutor = new MockActionExecutor({ token, service });
  }

  protected async deliver(action: ApprovedAction): Promise<RelayActionReceipt> {
    const result = await this.protectedExecutor.execute(action);
    return {
      actionId: action.id,
      sessionId: action.sessionId,
      provider: "mock",
      externalReference: result.externalReference ?? "",
      acceptedAt: this.now(),
      idempotencyKey: action.idempotencyKey,
    };
  }
}

export class ResendEmailExecutor extends BaseEmailExecutor {
  constructor(store: RelayJsonStore, private readonly config: EmailExecutorConfig, now?: () => string, private readonly request: typeof fetch = fetch) { super(store, now); }

  protected async deliver(action: ApprovedAction, payload: SendEmailPayload): Promise<RelayActionReceipt> {
    if (!this.config.resendApiKey || !this.config.resendFrom || !this.config.resendToOverride) throw new Error("Resend executor is not fully configured");
    const response = await this.request("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${this.config.resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": action.idempotencyKey }, body: JSON.stringify({ from: this.config.resendFrom, to: [this.config.resendToOverride], subject: payload.subject, text: payload.body }) });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok || !result.id) throw new Error(`Resend delivery failed: ${result.message ?? response.status}`);
    return { actionId: action.id, sessionId: action.sessionId, provider: "resend", externalReference: result.id, acceptedAt: this.now(), idempotencyKey: action.idempotencyKey };
  }
}

export function createEmailExecutor(
  config: EmailExecutorConfig,
  store: RelayJsonStore,
  mockService?: MockProtectedEmailService,
): ExternalActionExecutor {
  return config.provider === "resend"
    ? new ResendEmailExecutor(store, config)
    : new MockEmailExecutor(store, { token: config.executorToken || undefined, service: mockService });
}
