import type { Agent, AgentRun, Message, PolicySimulationResult, RelayAgentManifestView, RelaySession, SystemInfo } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let authToken = "";

export function setAuthToken(token: string): void {
  authToken = token.trim();
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = {
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
    ...options?.headers,
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data;
}

export const api = {
  auth: () => request<{ required: boolean }>("/api/auth"),
  system: () => request<SystemInfo>("/api/system"),
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  createAgent: (body: {
    name: string;
    description: string;
    instructions: string;
  }) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAgent: (
    id: string,
    body: { name: string; description: string; instructions: string },
  ) =>
    request<{ agent: Agent }>("/api/agents/" + id, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAgent: (id: string) =>
    request<{ archivedWorkspace: string }>("/api/agents/" + id, {
      method: "DELETE",
    }),
  startAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/start", {
      method: "POST",
    }),
  stopAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/stop", {
      method: "POST",
    }),
  messages: (id: string) =>
    request<{ messages: Message[] }>("/api/agents/" + id + "/messages"),
  runs: (id: string) =>
    request<{ runs: AgentRun[] }>("/api/agents/" + id + "/runs"),
  sendMessage: (id: string, content: string) =>
    request<{ run: AgentRun; message: Message }>(
      "/api/agents/" + id + "/messages",
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    ),
  run: (id: string) => request<{ run: AgentRun }>("/api/runs/" + id),
  relaySession: (id = "demo") =>
    request<{ session: RelaySession }>("/api/relay/sessions/" + encodeURIComponent(id)),
  listRelaySessions: () => request<{ sessions: RelaySession[] }>("/api/relay/sessions"),
  relayManifests: () => request<{ manifests: RelayAgentManifestView[] }>("/api/relay/manifests"),
  simulatePolicy: (body: { agentId: string; tool: "resource.read"; resource: string; operation: "read" }) =>
    request<{ result: PolicySimulationResult }>("/api/relay/policy/simulate", { method: "POST", body: JSON.stringify(body) }),
  createRelaySession: (body: { goal?: string; scenario?: "normal" | "timeout" | "denial" | "resource_scope_breach" | "bypass_protection" | "duplicate_approval" } = {}) =>
    request<{ session: RelaySession }>("/api/relay/sessions", { method: "POST", body: JSON.stringify(body) }),
  decideApproval: (id: string, decision: "approve" | "deny") =>
    request<{ session: RelaySession }>("/api/relay/approvals/" + id, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
};
