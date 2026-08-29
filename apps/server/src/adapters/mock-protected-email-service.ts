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
 */
export class MockProtectedEmailService {
  private readonly expectedToken: string;
  private readonly now: () => Date;
  private counter = 0;
  private transientFailuresRemaining = 0;
  private readonly ledger: ProtectedEmailRequest[] = [];

  constructor(options: { expectedToken: string; now?: () => Date }) {
    this.expectedToken = options.expectedToken;
    this.now = options.now ?? (() => new Date());
  }

  /** Queue `count` transient failures; the next `count` `send()` calls throw a generic error. */
  failNextSends(count: number): void {
    this.transientFailuresRemaining = Math.max(0, count);
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
    if (this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining -= 1;
      throw new Error("mock-protected-email-service: transient failure");
    }
    this.counter += 1;
    this.ledger.push(structuredClone(request));
    return {
      messageId: `msg-${this.counter}`,
      acceptedAt: this.now().toISOString(),
    };
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
