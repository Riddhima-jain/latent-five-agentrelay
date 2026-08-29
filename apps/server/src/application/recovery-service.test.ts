import { describe, expect, it, vi } from "vitest";
import type { ActionResult, ApprovedAction } from "../domain/action.js";
import type { ExternalActionExecutor } from "../domain/ports.js";
import { approvedEmailAction } from "../adapters/__fixtures__/actions.js";
import {
  ActionValidationError,
  ProtectedServiceAuthError,
  TransientExecutionError,
} from "./execution-errors.js";
import { RecoveryService } from "./recovery-service.js";

const action: ApprovedAction = approvedEmailAction();
const ok: ActionResult = { status: "succeeded", externalReference: "msg-1" };

const executorOf = (impl: () => Promise<ActionResult>): ExternalActionExecutor & { calls: number } => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async execute() {
      calls += 1;
      return impl();
    },
  } as ExternalActionExecutor & { calls: number };
};

describe("RecoveryService", () => {
  const service = new RecoveryService();

  it("returns a non-terminal success on the first attempt", async () => {
    const executor = executorOf(async () => ok);
    const outcome = await service.run(action, { executor, maxAttempts: 3, timeoutMs: 50 });
    expect(outcome).toEqual({ result: ok, terminal: false });
    expect(executor.calls).toBe(1);
  });

  it("retries a transient failure then succeeds", async () => {
    let n = 0;
    const executor = executorOf(async () => {
      n += 1;
      if (n === 1) throw new TransientExecutionError("flaky");
      return ok;
    });
    const onRetry = vi.fn();
    const outcome = await service.run(action, { executor, maxAttempts: 2, timeoutMs: 50, onRetry });
    expect(outcome.terminal).toBe(false);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1);
    expect(executor.calls).toBe(2);
  });

  it("returns terminal after exhausting transient retries", async () => {
    const executor = executorOf(async () => {
      throw new TransientExecutionError("always flaky");
    });
    const onRetry = vi.fn();
    const outcome = await service.run(action, { executor, maxAttempts: 2, timeoutMs: 50, onRetry });
    expect(outcome.terminal).toBe(true);
    expect(outcome.result.status).toBe("failed");
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(executor.calls).toBe(2);
  });

  it("does not retry a ProtectedServiceAuthError", async () => {
    const executor = executorOf(async () => {
      throw new ProtectedServiceAuthError();
    });
    const onRetry = vi.fn();
    const outcome = await service.run(action, { executor, maxAttempts: 3, timeoutMs: 50, onRetry });
    expect(outcome.terminal).toBe(true);
    expect(onRetry).not.toHaveBeenCalled();
    expect(executor.calls).toBe(1);
  });

  it("does not retry an ActionValidationError", async () => {
    const executor = executorOf(async () => {
      throw new ActionValidationError("bad payload");
    });
    const outcome = await service.run(action, { executor, maxAttempts: 3, timeoutMs: 50 });
    expect(outcome.terminal).toBe(true);
    expect(executor.calls).toBe(1);
  });

  it("fails closed on an unrecognized executor error without retrying", async () => {
    const executor = executorOf(async () => {
      throw new Error("boom");
    });
    const onRetry = vi.fn();
    const outcome = await service.run(action, { executor, maxAttempts: 3, timeoutMs: 50, onRetry });
    expect(outcome.terminal).toBe(true);
    expect(outcome.result.status).toBe("failed");
    expect(outcome.reason).toMatch(/^UNKNOWN_EXECUTION_ERROR/);
    expect(onRetry).not.toHaveBeenCalled();
    expect(executor.calls).toBe(1);
  });

  it("does not leak an unhandled rejection when a timed-out attempt later rejects", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const executor = executorOf(
        () =>
          new Promise<ActionResult>((_, reject) => setTimeout(() => reject(new Error("late")), 30)),
      );
      const outcome = await service.run(action, { executor, maxAttempts: 1, timeoutMs: 5 });
      expect(outcome.terminal).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      expect(rejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("times out a hung attempt and treats it as transient", async () => {
    const executor = executorOf(() => new Promise<ActionResult>(() => {}));
    const onRetry = vi.fn();
    const outcome = await service.run(action, { executor, maxAttempts: 2, timeoutMs: 10, onRetry });
    expect(outcome.terminal).toBe(true);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
