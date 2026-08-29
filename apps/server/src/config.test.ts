import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const baseEnv = { NODE_ENV: "test" as const };

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
