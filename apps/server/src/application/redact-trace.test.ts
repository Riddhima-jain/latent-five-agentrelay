import { describe, expect, it } from "vitest";
import { scrubSecrets, summarizePayload } from "./redact-trace.js";

const TOKEN = "executor-token-1234567890-abcdefghij";

describe("summarizePayload", () => {
  it("summarizes a SEND_EMAIL payload by body length, not content", () => {
    const summary = summarizePayload("SEND_EMAIL", {
      recipient: "a@example.com",
      subject: "s",
      body: "12345",
    });
    expect(summary).toBe("SEND_EMAIL, 5 chars");
    expect(summary).not.toContain("a@example.com");
  });

  it("falls back to JSON length for other payload shapes", () => {
    expect(summarizePayload("OTHER", { a: 1 })).toBe(`OTHER, ${JSON.stringify({ a: 1 }).length} chars`);
  });
});

describe("scrubSecrets", () => {
  it("redacts a string equal to or containing the executor token", () => {
    const out = scrubSecrets({ note: `token is ${TOKEN}`, plain: "ok" }, [TOKEN]);
    expect(out).toEqual({ note: "[REDACTED]", plain: "ok" });
  });

  it("redacts every bearer credential in a string", () => {
    const out = scrubSecrets({ auth: "Bearer abc.def.ghi and also Bearer zzz999" }, []);
    expect(out.auth).toBe("bearer [REDACTED] and also bearer [REDACTED]");
  });

  it("redacts a token containing punctuation the old heuristic missed", () => {
    const punct = "exec.tok~en+aa/bb==ccddeeff";
    const out = scrubSecrets({ note: `header ${punct}` }, [punct]);
    expect(out.note).toBe("[REDACTED]");
  });

  it("recurses into nested objects and arrays", () => {
    const out = scrubSecrets({ a: { b: [{ c: TOKEN }] } }, [TOKEN]);
    expect(out).toEqual({ a: { b: [{ c: "[REDACTED]" }] } });
  });

  it("leaves ordinary strings and long identifiers untouched (no random-looking heuristic)", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const out = scrubSecrets(
      { recipient: "customer@example.com", type: "SEND_EMAIL", actionId: uuid, externalReference: "msg-01HXYZ0123456789ABCDEFGHJK" },
      [TOKEN],
    );
    expect(out).toEqual({
      recipient: "customer@example.com",
      type: "SEND_EMAIL",
      actionId: uuid,
      externalReference: "msg-01HXYZ0123456789ABCDEFGHJK",
    });
  });
});
