import type { ExecutionRecord } from "../application/execution-ports.js";

const FORBIDDEN_RESULT_KEYS = new Set(["status", "externalReference", "error"]);
const PAYLOAD_FIELD_KEYS = new Set(["recipient", "subject", "body", "payload"]);

/**
 * Enforces plan R13 at the persistence boundary: an `ExecutionRecord` carries
 * `payloadHash` only, never `SendEmailPayload` fields, and its `result` is a
 * bare `ActionResult`. Throws before a leaking record is written.
 */
export function assertNoPayloadLeak(record: ExecutionRecord): void {
  for (const key of Object.keys(record)) {
    if (PAYLOAD_FIELD_KEYS.has(key)) {
      throw new Error(`ExecutionRecord must not carry payload field "${key}" (R13)`);
    }
  }
  if (record.result) {
    for (const key of Object.keys(record.result)) {
      if (!FORBIDDEN_RESULT_KEYS.has(key)) {
        throw new Error(`ExecutionRecord.result must be a bare ActionResult; found "${key}" (R13)`);
      }
    }
  }
}
