import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { CodexRunner } from "./codex-runner.js";
import { ContainerCodexRunner, buildContainerRunArgs } from "./container-codex-runner.js";
import type { RunnerRequest } from "./types.js";

/**
 * Plan U8 / R2 / R3: the executor token must never reach the Agent Runtime.
 * The runners use an explicit inherited-name allowlist, so the token is
 * excluded today; this regression test guards against a future edit that adds it.
 */

const SENTINEL = "SENTINEL-executor-token-1234567890-abcdef";

let previous: string | undefined;
beforeEach(() => {
  previous = process.env.AGENTRELAY_EXECUTOR_TOKEN;
  process.env.AGENTRELAY_EXECUTOR_TOKEN = SENTINEL;
});
afterEach(() => {
  if (previous === undefined) delete process.env.AGENTRELAY_EXECUTOR_TOKEN;
  else process.env.AGENTRELAY_EXECUTOR_TOKEN = previous;
});

const config = () =>
  loadConfig({ NODE_ENV: "test", AGENTRELAY_EXECUTOR_TOKEN: SENTINEL });

const childEnvOf = (runner: object): NodeJS.ProcessEnv =>
  (runner as unknown as { childEnvironment(): NodeJS.ProcessEnv }).childEnvironment();

const request: RunnerRequest = {
  agentId: "research-agent",
  workspacePath: "/tmp/ws",
  prompt: "hi",
  threadId: null,
};

describe("runner env isolation", () => {
  it("CodexRunner child env carries neither the token key nor its value", () => {
    const env = childEnvOf(new CodexRunner(config()));
    expect(env).not.toHaveProperty("AGENTRELAY_EXECUTOR_TOKEN");
    expect(Object.values(env)).not.toContain(SENTINEL);
  });

  it("ContainerCodexRunner child env carries neither the token key nor its value", () => {
    const env = childEnvOf(new ContainerCodexRunner(config()));
    expect(env).not.toHaveProperty("AGENTRELAY_EXECUTOR_TOKEN");
    expect(Object.values(env)).not.toContain(SENTINEL);
  });

  it("the container run argv does not reference the token", () => {
    const argv = buildContainerRunArgs(request, config());
    expect(argv).not.toContain("AGENTRELAY_EXECUTOR_TOKEN");
    expect(argv.join(" ")).not.toContain(SENTINEL);
  });

  it("still forwards the model keys the runner legitimately needs", () => {
    const env = childEnvOf(new CodexRunner(config()));
    expect(env).toHaveProperty("ARK_API_KEY");
    expect(env).toHaveProperty("GEMINI_API_KEY");
  });
});
