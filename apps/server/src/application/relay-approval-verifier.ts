import type { ApprovedAction } from "../domain/action.js";
import { payloadHashFor } from "./approval-service.js";
import type { ApprovalVerifier } from "./execution-ports.js";
import type { RelayJsonStore } from "./relay-store.js";

type Verdict = Awaited<ReturnType<ApprovalVerifier["isSatisfied"]>>;

/**
 * Production `ApprovalVerifier` over the Relay approval store (plan U10, KTD9).
 * Person 4 reads approval state; Person 3 owns the writes. The approval id
 * convention matches `relay-workflow-service`: `approval-${action.id}`.
 */
export class RelayApprovalVerifier implements ApprovalVerifier {
  constructor(private readonly store: RelayJsonStore) {}

  async isSatisfied(action: ApprovedAction): Promise<Verdict> {
    const approval = await this.store.getApproval(`approval-${action.id}`);
    if (!approval) return { ok: false, reason: "NO_APPROVAL" };
    if (approval.status === "denied") return { ok: false, reason: "APPROVAL_DENIED" };
    if (approval.status === "invalidated") return { ok: false, reason: "APPROVAL_INVALIDATED" };
    if (approval.status !== "approved") return { ok: false, reason: "NO_APPROVAL" };
    const currentHash = payloadHashFor(action);
    if (approval.payloadHash !== currentHash || action.payloadHash !== currentHash) {
      return { ok: false, reason: "HASH_MISMATCH" };
    }
    return { ok: true };
  }
}
