export type AgentPermission =
  | "read"
  | "internal_write"
  | "external_write"
  | "destructive";

/** The stable identity and server-verified abilities used for task routing. */
export interface AgentManifest {
  agentId: string;
  name: string;
  capabilities: string[];
  permissions: AgentPermission[];
  /** A stopped, busy, or otherwise unavailable agent is not eligible for routing. */
  runnable: boolean;
  /** Trusted resource-tool policy, independent from external-action permissions. */
  toolPolicy: import("./tool-access.js").AgentAccessPolicy;
}
