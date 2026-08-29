import { describe, expect, it } from "vitest";
import {
  ActionValidationError,
  ProtectedServiceAuthError,
  TransientExecutionError,
} from "../application/execution-errors.js";
import { approvedEmailAction } from "./__fixtures__/actions.js";
import { MockActionExecutor } from "./mock-action-executor.js";
import { MockProtectedEmailService } from "./mock-protected-email-service.js";

const TOKEN = "executor-token-1234567890-abcdefghij";
const fixedClock = () => new Date("2026-08-29T12:00:00.000Z");

const build = (serviceToken = TOKEN) => {
  const service = new MockProtectedEmailService({ expectedToken: serviceToken, now: fixedClock });
  const executor = new MockActionExecutor({ token: TOKEN, service });
  return { service, executor };
};

describe("MockActionExecutor", () => {
  it("sends a valid action with the executor token and returns a succeeded result", async () => {
    const { service, executor } = build();

    const result = await executor.execute(approvedEmailAction());

    expect(result).toEqual({ status: "succeeded", externalReference: "msg-1" });
    expect(service.sentCount).toBe(1);
    expect(service.sent[0]).toMatchObject({ sessionId: "session-1", actionId: "action-1" });
  });

  it("throws on construction with a placeholder or short token", () => {
    const service = new MockProtectedEmailService({ expectedToken: TOKEN });
    expect(() => new MockActionExecutor({ token: "replace-me-please-1234567890", service })).toThrow();
    expect(() => new MockActionExecutor({ token: "too-short", service })).toThrow();
  });

  it("rejects a non-protected action type without sending", async () => {
    const { service, executor } = build();
    await expect(
      executor.execute(approvedEmailAction({ type: "CREATE_INTERNAL_DRAFT" })),
    ).rejects.toBeInstanceOf(ActionValidationError);
    expect(service.sentCount).toBe(0);
  });

  it("rejects an invalid payload without sending", async () => {
    const { service, executor } = build();
    await expect(
      executor.execute(approvedEmailAction({ payload: { subject: "x", body: "y" } })),
    ).rejects.toBeInstanceOf(ActionValidationError);
    expect(service.sentCount).toBe(0);
  });

  it("propagates ProtectedServiceAuthError when the service rejects the token", async () => {
    const { executor } = build("a-different-expected-token-000000");
    await expect(executor.execute(approvedEmailAction())).rejects.toBeInstanceOf(
      ProtectedServiceAuthError,
    );
  });

  it("wraps a transient service failure as TransientExecutionError", async () => {
    const { service, executor } = build();
    service.failNextSends(1);
    await expect(executor.execute(approvedEmailAction())).rejects.toBeInstanceOf(
      TransientExecutionError,
    );
  });

  it("never exposes the token on the result", async () => {
    const { executor } = build();
    const result = await executor.execute(approvedEmailAction());
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
