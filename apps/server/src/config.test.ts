import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const baseEnv = { NODE_ENV: "test" as const };

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

describe("loadConfig — AGENTRELAY_EXECUTOR_TOKEN", () => {
  it("surfaces a valid executor token on the config object", () => {
    const token = "executor-token-1234567890-abcdefghij";
    const config = loadConfig({ ...baseEnv, AGENTRELAY_EXECUTOR_TOKEN: token });
    expect(config.executorToken).toBe(token);
  });

  it("rejects a token shorter than 24 characters", () => {
    expect(() => loadConfig({ ...baseEnv, AGENTRELAY_EXECUTOR_TOKEN: "too-short" })).toThrow();
  });

  it("defaults to an empty string when unset and still loads", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.executorToken).toBe("");
  });
});
