import { describe, expect, it } from "vitest";
import type { ProtectedEmailRequest } from "../domain/protected-action.js";
import { ProtectedServiceAuthError } from "../application/execution-errors.js";
import { MockProtectedEmailService } from "./mock-protected-email-service.js";

const TOKEN = "executor-token-1234567890-abcdefghij";

const request = (): ProtectedEmailRequest => ({
  sessionId: "session-1",
  actionId: "action-1",
  payload: { recipient: "a@example.com", subject: "Hi", body: "Body text" },
});

const fixedClock = () => new Date("2026-08-29T12:00:00.000Z");

describe("MockProtectedEmailService", () => {
  it("accepts a send with the valid token and returns a deterministic receipt", async () => {
    const service = new MockProtectedEmailService({ expectedToken: TOKEN, now: fixedClock });

    const receipt = await service.send(TOKEN, request());

    expect(receipt).toEqual({ messageId: "msg-1", acceptedAt: "2026-08-29T12:00:00.000Z" });
    expect(service.sentCount).toBe(1);
  });

  it("rejects a missing token with a 403-shaped error and records nothing", async () => {
    const service = new MockProtectedEmailService({ expectedToken: TOKEN });

    await expect(service.send("", request())).rejects.toBeInstanceOf(ProtectedServiceAuthError);
    await expect(service.send("", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(service.sentCount).toBe(0);
  });

  it("rejects a wrong token and records nothing", async () => {
    const service = new MockProtectedEmailService({ expectedToken: TOKEN });

    await expect(service.send("wrong-token", request())).rejects.toBeInstanceOf(
      ProtectedServiceAuthError,
    );
    expect(service.sentCount).toBe(0);
  });

  it("produces identical receipts across two services with the same seed clock", async () => {
    const a = new MockProtectedEmailService({ expectedToken: TOKEN, now: fixedClock });
    const b = new MockProtectedEmailService({ expectedToken: TOKEN, now: fixedClock });

    expect(await a.send(TOKEN, request())).toEqual(await b.send(TOKEN, request()));
  });

  it("gives two successful sends distinct message ids", async () => {
    const service = new MockProtectedEmailService({ expectedToken: TOKEN, now: fixedClock });

    const first = await service.send(TOKEN, request());
    const second = await service.send(TOKEN, request());

    expect(first.messageId).not.toEqual(second.messageId);
    expect(service.sentCount).toBe(2);
  });

  it("throws a non-auth error while transient failures are queued", async () => {
    const service = new MockProtectedEmailService({ expectedToken: TOKEN, now: fixedClock });
    service.failNextSends(1);

    await expect(service.send(TOKEN, request())).rejects.not.toBeInstanceOf(
      ProtectedServiceAuthError,
    );
    expect(service.sentCount).toBe(0);

    await expect(service.send(TOKEN, request())).resolves.toMatchObject({ messageId: "msg-1" });
  });
});
