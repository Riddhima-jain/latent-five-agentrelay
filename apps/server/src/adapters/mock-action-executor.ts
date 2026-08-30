import { z } from "zod";
import type { ActionResult, ApprovedAction } from "../domain/action.js";
import type { ExternalActionExecutor } from "../domain/ports.js";
import { PROTECTED_ACTION_TYPE } from "../domain/protected-action.js";
import {
  ActionValidationError,
  ProtectedServiceAuthError,
  TransientExecutionError,
} from "../application/execution-errors.js";
import type { MockProtectedEmailService } from "./mock-protected-email-service.js";

const sendEmailPayloadSchema = z
  .object({
    recipient: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

/**
 * The trusted `ExternalActionExecutor` (plan U3). It is the ONLY holder of the
 * executor token: the token comes from private config and never appears in the
 * action, the result, a trace event, or any object this class exposes.
 *
 * Error convention (plan KTD5, fixes the U7 ambiguity): every failure throws a
 * typed error; a plain `ActionResult` is returned only on success.
 * - `ActionValidationError` — bad payload or wrong action type. Terminal.
 * - `ProtectedServiceAuthError` — service rejected the token. Terminal.
 * - `TransientExecutionError` — any other service failure. Retryable.
 */
export class MockActionExecutor implements ExternalActionExecutor {
  private readonly token: string;
  private readonly service: MockProtectedEmailService;

  constructor(options: { token: string; service: MockProtectedEmailService }) {
    const token = options.token ?? "";
    if (token.length < 24 || token.startsWith("replace-")) {
      throw new Error(
        "MockActionExecutor requires a real AGENTRELAY_EXECUTOR_TOKEN (>= 24 chars, not a replace- placeholder)",
      );
    }
    this.token = token;
    this.service = options.service;
  }

  async execute(action: ApprovedAction): Promise<ActionResult> {
    if (action.type !== PROTECTED_ACTION_TYPE) {
      throw new ActionValidationError(`Unsupported protected action type: ${action.type}`);
    }

    const parsed = sendEmailPayloadSchema.safeParse(action.payload);
    if (!parsed.success) {
      throw new ActionValidationError(`Invalid SEND_EMAIL payload: ${parsed.error.message}`);
    }

    let receipt;
    try {
      receipt = await this.service.send(this.token, {
        sessionId: action.sessionId,
        actionId: action.id,
        payload: parsed.data,
      });
    } catch (error) {
      if (error instanceof ProtectedServiceAuthError) {
        throw error;
      }
      throw new TransientExecutionError(
        `Protected email service call failed: ${(error as Error).message}`,
        { cause: error },
      );
    }

    return { status: "succeeded", externalReference: receipt.messageId };
  }
}
