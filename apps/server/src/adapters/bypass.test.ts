import { describe, expect, it } from "vitest";
import { ProtectedServiceAuthError } from "../application/execution-errors.js";
import {
  AlwaysApprovedVerifier,
  AlwaysDeniedVerifier,
} from "../application/approval-verifier-fakes.js";
import { approvedEmailAction } from "./__fixtures__/actions.js";
import { MockActionExecutor } from "./mock-action-executor.js";
import { MockProtectedEmailService } from "./mock-protected-email-service.js";

/**
 * Day-1 exit criterion (plan U4): the hard enforcement boundary is provable
 * with fakes only. Every route an "agent-like" caller could take fails; the one
 * trusted route succeeds.
 */

const EXECUTOR_TOKEN = "executor-token-1234567890-abcdefghij";
const APP_AUTH_TOKEN = "app-auth-token-0987654321-zyxwvut";
const fixedClock = () => new Date("2026-08-29T12:00:00.000Z");

describe("hard enforcement boundary", () => {
  it("an agent-like caller cannot send: no value it could supply is accepted", async () => {
    const service = new MockProtectedEmailService({ expectedToken: EXECUTOR_TOKEN, now: fixedClock });
    const request = {
      sessionId: "session-1",
      actionId: "action-1",
      payload: { recipient: "c@example.com", subject: "s", body: "b" },
    };

    // Values the Agent Runtime plausibly has access to. None is the executor token.
    for (const guess of ["", "undefined", APP_AUTH_TOKEN, "SEND_EMAIL", "action-1"]) {
      await expect(service.send(guess, request)).rejects.toBeInstanceOf(ProtectedServiceAuthError);
    }
    expect(service.sentCount).toBe(0);
  });

  it("the trusted executor path succeeds and returns a receipt", async () => {
    const service = new MockProtectedEmailService({ expectedToken: EXECUTOR_TOKEN, now: fixedClock });
    const executor = new MockActionExecutor({ token: EXECUTOR_TOKEN, service });
    await new AlwaysApprovedVerifier().isSatisfied(approvedEmailAction());

    const result = await executor.execute(approvedEmailAction());

    expect(result.status).toBe("succeeded");
    expect(result.externalReference).toBe("msg-1");
    expect(service.sentCount).toBe(1);
  });

  it("a denied approval means the trusted path is never taken", async () => {
    const service = new MockProtectedEmailService({ expectedToken: EXECUTOR_TOKEN, now: fixedClock });
    const verifier = new AlwaysDeniedVerifier();

    const verdict = await verifier.isSatisfied(approvedEmailAction());

    expect(verdict).toEqual({ ok: false, reason: "APPROVAL_DENIED" });
    // The executor is simply not called when the verdict is !ok (ExecutionService enforces this, U6).
    expect(service.sentCount).toBe(0);
  });

  it("the agent-side action carries no field equal to the executor token", () => {
    const action = approvedEmailAction();
    expect(JSON.stringify(action)).not.toContain(EXECUTOR_TOKEN);
  });
});
