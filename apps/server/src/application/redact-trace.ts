import { PROTECTED_ACTION_TYPE, type SendEmailPayload } from "../domain/protected-action.js";

/**
 * Trace redaction for the executor boundary (plan R12, KTD7).
 * Applied before any `TraceSink.append` — redaction happens before persistence.
 */

const REDACTED = "[REDACTED]";
const BEARER = /bearer\s+\S+/gi;

/** One-line summary of a protected payload — never the raw body (plan R12). */
export function summarizePayload(type: string, payload: unknown): string {
  if (type === PROTECTED_ACTION_TYPE && isSendEmailPayload(payload)) {
    return `${type}, ${payload.body.length} chars`;
  }
  const size = safeJsonLength(payload);
  return `${type}, ${size} chars`;
}

/**
 * Deep-clone `value`, replacing any string that contains one of `secrets`, or a
 * `bearer <token>` credential, with `[REDACTED]`. The explicit `secrets` list is
 * the real control (the executor boundary always knows its token); this is a
 * backstop — callers still build metadata from safe fields only.
 *
 * There is no generic "looks long and random" heuristic: it both under-matched
 * (tokens with `.~+/=`) and over-matched (UUID `actionId` / `traceId` values,
 * breaking trace correlation).
 */
export function scrubSecrets<T>(value: T, secrets: readonly string[]): T {
  const active = secrets.filter((s) => typeof s === "string" && s.length > 0);
  return walk(value, active) as T;
}

function walk(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, secrets));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = walk(inner, secrets);
    }
    return out;
  }
  return value;
}

function redactString(input: string, secrets: readonly string[]): string {
  if (secrets.some((secret) => input.includes(secret))) {
    return REDACTED;
  }
  return input.replace(BEARER, `bearer ${REDACTED}`);
}

function isSendEmailPayload(value: unknown): value is SendEmailPayload {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).body === "string"
  );
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}
