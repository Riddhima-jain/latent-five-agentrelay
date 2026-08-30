import path from "node:path";
import type { AccessGrant, ToolAccessDecision, ToolAccessRequest } from "../domain/tool-access.js";

export function normalizeLogicalResource(resource: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(resource); } catch { throw new Error("RESOURCE_OUT_OF_SCOPE"); }
  if (!decoded || decoded.includes("\0") || decoded.includes("\\") || decoded.startsWith("/") || path.posix.isAbsolute(decoded)) throw new Error("RESOURCE_OUT_OF_SCOPE");
  const normalized = path.posix.normalize(decoded);
  if (normalized === ".." || normalized.startsWith("../") || normalized !== decoded || decoded.includes("%")) throw new Error("RESOURCE_OUT_OF_SCOPE");
  return normalized;
}

export class ToolPolicyService {
  constructor(private readonly now: () => number = () => Date.now()) {}
  evaluate(grant: AccessGrant | null, request: ToolAccessRequest): ToolAccessDecision {
    if (!grant || grant.id !== request.grantId) return { decision: "DENY", reason: "INVALID_GRANT" };
    if (grant.status === "revoked") return { decision: "DENY", reason: "GRANT_REVOKED" };
    if (grant.status === "expired" || (grant.expiresAt && Date.parse(grant.expiresAt) <= this.now())) return { decision: "DENY", reason: "GRANT_EXPIRED" };
    if (!grant.allowedTools.includes(request.tool)) return { decision: "DENY", reason: "TOOL_NOT_ALLOWED" };
    let resource: string;
    try { resource = normalizeLogicalResource(request.resource); } catch { return { decision: "DENY", reason: "RESOURCE_OUT_OF_SCOPE" }; }
    const scope = grant.resourceScopes.find((candidate) => candidate.pattern.endsWith("/*") ? resource.startsWith(candidate.pattern.slice(0, -1)) : resource === candidate.pattern);
    if (!scope) return { decision: "DENY", reason: "RESOURCE_OUT_OF_SCOPE" };
    if (!scope.permissions.includes(request.operation)) return { decision: "DENY", reason: "OPERATION_NOT_ALLOWED" };
    return { decision: "ALLOW", reason: "GRANT_PERMITS_REQUEST" };
  }
}
