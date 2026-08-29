import type { ApprovedAction } from "../domain/action.js";
import type { ApprovalVerifier } from "./execution-ports.js";

type VerifierResult = Awaited<ReturnType<ApprovalVerifier["isSatisfied"]>>;

/** Test double: every action is approved. For isolated development against Persons 1/3/5. */
export class AlwaysApprovedVerifier implements ApprovalVerifier {
  async isSatisfied(): Promise<VerifierResult> {
    return { ok: true };
  }
}

/** Test double: every action is denied. */
export class AlwaysDeniedVerifier implements ApprovalVerifier {
  async isSatisfied(): Promise<VerifierResult> {
    return { ok: false, reason: "APPROVAL_DENIED" };
  }
}

/** Test double with a per-action or default configured result. */
export class StubApprovalVerifier implements ApprovalVerifier {
  private readonly byActionId = new Map<string, VerifierResult>();

  constructor(private readonly fallback: VerifierResult = { ok: true }) {}

  set(actionId: string, result: VerifierResult): this {
    this.byActionId.set(actionId, result);
    return this;
  }

  async isSatisfied(action: ApprovedAction): Promise<VerifierResult> {
    return this.byActionId.get(action.id) ?? this.fallback;
  }
}
