import { timingSafeEqual } from "node:crypto";
import type {
  ProtectedEmailReceipt,
  ProtectedEmailRequest,
} from "../domain/protected-action.js";
import { ProtectedServiceAuthError } from "../application/execution-errors.js";

/**
 * The deterministic "external" service for the P0 demo (plan U2, KTD1).
 *
 * In-process, not a real HTTP listener: the executor token is a private
 * constructor arg the Agent Runtime never receives, and `send()` rejects any
 * caller that does not present it. The method shape and receipt match what an
 * HTTP route would expose so Person 5 can wrap it later.
 *
 * `send()` is idempotent on `sessionId|actionId`: a repeat request (a retry
 * after a lost ACK, or a race the middleware's own guard did not stop) returns
 * the stored receipt without sending a second email. This makes the mock a
 * faithful stand-in for an idempotent endpoint and is what keeps the retry
 * path from breaking exactly-once (plan R7/R8).
 */
export class MockProtectedEmailService {
  private readonly expectedToken: string;
  private readonly now: () => Date;
  private counter = 0;
  private transientFailuresRemaining = 0;
  private readonly errorQueue: Error[] = [];
  private readonly ledger: ProtectedEmailRequest[] = [];
  private readonly receipts = new Map<string, ProtectedEmailReceipt>();

  constructor(options: { expectedToken: string; now?: (() => Date) | undefined }) {
    this.expectedToken = options.expectedToken;
    this.now = options.now ?? (() => new Date());
  }

  /** Queue `count` transient failures; the next `count` `send()` calls throw a generic error. */
  failNextSends(count: number): void {
    this.transientFailuresRemaining = Math.max(0, count);
  }

  /** Make the next `send()` throw exactly this error (used to test failure-reason redaction). */
  failNextSendWith(error: Error): void {
    this.errorQueue.push(error);
  }

  /** Requests accepted so far (test read surface). */
  get sent(): readonly ProtectedEmailRequest[] {
    return this.ledger;
  }

  get sentCount(): number {
    return this.ledger.length;
  }

  async send(token: string, request: ProtectedEmailRequest): Promise<ProtectedEmailReceipt> {
    if (!this.tokenMatches(token)) {
      throw new ProtectedServiceAuthError();
    }
    const dedupeKey = `${request.sessionId}|${request.actionId}`;
    const prior = this.receipts.get(dedupeKey);
    if (prior) {
      return prior;
    }
    const queued = this.errorQueue.shift();
    if (queued) {
      throw queued;
    }
    if (this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining -= 1;
      throw new Error("mock-protected-email-service: transient failure");
    }
    this.counter += 1;
    this.ledger.push(structuredClone(request));
    const receipt: ProtectedEmailReceipt = {
      messageId: `msg-${this.counter}`,
      acceptedAt: this.now().toISOString(),
    };
    this.receipts.set(dedupeKey, receipt);
    return receipt;
  }

  private tokenMatches(token: string): boolean {
    if (typeof token !== "string" || token.length === 0) {
      return false;
    }
    const provided = Buffer.from(token, "utf8");
    const expected = Buffer.from(this.expectedToken, "utf8");
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(provided, expected);
  }
}
