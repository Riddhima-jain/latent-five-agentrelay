import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("email executor configuration", () => {
  it("uses the mock executor by default", () => {
    expect(loadConfig({ NODE_ENV: "test" }).emailExecutor).toBe("mock");
  });

  it("fails closed when Resend configuration is incomplete", () => {
    expect(() => loadConfig({ NODE_ENV: "test", EMAIL_EXECUTOR: "resend", RESEND_API_KEY: "secret" })).toThrow(/requires RESEND_API_KEY/);
  });

  it("accepts a complete Resend override configuration", () => {
    const config = loadConfig({ NODE_ENV: "test", EMAIL_EXECUTOR: "resend", RESEND_API_KEY: "secret", RESEND_FROM: "AgentRelay <verified@example.com>", RESEND_TO_OVERRIDE: "team@example.com" });
    expect(config).toMatchObject({ emailExecutor: "resend", resendToOverride: "team@example.com" });
  });
});
