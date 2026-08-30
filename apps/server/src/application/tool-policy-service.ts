import type { AccessGrant, ToolAccessDecision, ToolAccessRequest } from "../domain/tool-access.js";

export interface ToolPolicyService {
  evaluate(grant: AccessGrant, request: ToolAccessRequest): ToolAccessDecision;
}

export class DeterministicToolPolicyService implements ToolPolicyService {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  evaluate(grant: AccessGrant, request: ToolAccessRequest): ToolAccessDecision {
    if (!grant.id || request.grantId !== grant.id) return deny("INVALID_GRANT");
    if (grant.status === "revoked") return deny("GRANT_REVOKED");
    if (grant.status === "expired" || (grant.expiresAt !== undefined && Date.parse(grant.expiresAt) <= Date.parse(this.now()))) return deny("GRANT_EXPIRED");
    if (!grant.allowedTools.includes(request.tool)) return deny("TOOL_NOT_ALLOWED");
    const resource = normalizeLogicalResource(request.resource);
    const matchingScope = grant.resourceScopes.find((scope) => scopeMatches(scope.pattern, resource));
    if (!matchingScope) return deny("RESOURCE_OUT_OF_SCOPE");
    if (!matchingScope.permissions.includes(request.operation)) return deny("OPERATION_NOT_ALLOWED");
    return { decision: "ALLOW", reason: "GRANT_PERMITS_REQUEST" };
  }
}

export function normalizeLogicalResource(resource: string): string {
  let decoded = resource;
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      throw new Error("Invalid encoded resource identifier");
    }
  }
  if (!decoded || decoded.includes("\0") || decoded.includes("\\") || decoded.startsWith("/") || /^[a-zA-Z]:/.test(decoded)) {
    throw new Error("Invalid logical resource identifier");
  }
  const segments = decoded.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid logical resource identifier");
  }
  return decoded;
}

export function scopeMatches(pattern: string, resource: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return resource.startsWith(prefix) && resource.length > prefix.length;
  }
  return resource === pattern;
}

function deny(reason: Extract<ToolAccessDecision, { decision: "DENY" }> ["reason"]): ToolAccessDecision {
  return { decision: "DENY", reason };
}
