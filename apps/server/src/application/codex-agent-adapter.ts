import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentExecutor, ExecutionContext } from "../domain/ports.js";
import type { AgentExecutionResult, AgentTask } from "../domain/task.js";
import type { AgentRunner } from "../types.js";
import { validateAgentExecutionResult } from "./result-validator.js";

export interface WorkflowAgentRuntime {
  agentId: string;
  workspacePath: string;
}

/** Adapts the starter-kit Codex runner without letting Playground history enter a workflow. */
export class CodexAgentAdapter implements AgentExecutor {
  private readonly agents = new Map<string, WorkflowAgentRuntime>();
  private readonly workflowThreads = new Map<string, string>();

  constructor(
    private readonly runner: AgentRunner,
    agents: readonly WorkflowAgentRuntime[],
  ) {
    for (const agent of agents) this.agents.set(agent.agentId, { ...agent });
  }

  async execute(agentId: string, task: AgentTask, context: ExecutionContext): Promise<AgentExecutionResult> {
    if (context.sessionId !== task.sessionId || context.taskId !== task.id) {
      throw new Error("Execution context does not match the workflow task");
    }
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Workflow agent is not registered: ${agentId}`);

    const sessionKey = `${context.sessionId}:${agentId}`;
    const resourceHelperEnvironment = await prepareResourceHelper(agent.workspacePath, context);
    const response = await this.runner.run({
      // A unique runner identity prevents an Agent's normal Playground turn from
      // colliding with a workflow run, particularly for the container runner.
      agentId: workflowRunnerId(sessionKey),
      workspacePath: agent.workspacePath,
      prompt: buildWorkflowPrompt(task, context),
      threadId: this.workflowThreads.get(sessionKey) ?? null,
      ...(resourceHelperEnvironment ? { environment: resourceHelperEnvironment } : {}),
    });
    if (response.threadId) this.workflowThreads.set(sessionKey, response.threadId);

    const parsedJson = parseJson(response.output);
    const validation = validateAgentExecutionResult(parsedJson);
    if (!validation.valid) throw new Error(`${validation.code}: ${validation.issues.join("; ")}`);
    return validation.result;
  }
}

export function workflowRunnerId(sessionKey: string): string {
  return `workflow-${createHash("sha256").update(sessionKey).digest("hex").slice(0, 24)}`;
}

export function buildWorkflowPrompt(
  task: AgentTask,
  context: ExecutionContext,
): string {
  return [
    "You are a workflow participant. Treat the following Context Capsule as the complete workflow context.",
    "Do not rely on prior conversations or instructions outside this prompt.",
    "Use only the logical protected-resource handles explicitly included in the Context Capsule. Raw protected files are not mounted in this workspace. Do not execute external actions; propose them in the output only.",
    "Return exactly one JSON object, with no Markdown fences or commentary, matching:",
    '{"summary":"string","evidence":[{"claim":"string","sourceRefs":["string"]}],"proposedActions":[{"type":"string","target":"string","payload":{},"rationale":"string optional"}]}',
    "",
    `Current task: ${JSON.stringify({ id: task.id, title: task.title, requiredCapability: task.requiredCapability })}`,
    ...(task.requiredPermissions.includes("external_write") ? [
      'For this outreach task, propose exactly one SEND_EMAIL action. Its payload must be {"recipient":"string","subject":"string","body":"string"}. Do not send it yourself.',
    ] : []),
    `Context Capsule: ${JSON.stringify({ goal: context.goal, constraints: context.constraints, dependencyEvidence: context.dependencyEvidence })}`,
    `Resource access: ${JSON.stringify(context.resourceAccess ?? { allowedResourceHandles: context.allowedResources })}`,
    ...(context.resourceAccess && context.accessGrant ? ["Read a listed protected resource only with: node .agentrelay/bin/agentrelay-resource.mjs read <logical-resource-handle>"] : []),
  ].join("\n");
}

async function prepareResourceHelper(workspacePath: string, context: ExecutionContext): Promise<Record<string, string> | undefined> {
  if (!context.resourceAccess || !context.accessGrant) return undefined;
  const helperDirectory = path.join(workspacePath, ".agentrelay", "bin");
  await mkdir(helperDirectory, { recursive: true });
  await writeFile(path.join(helperDirectory, "agentrelay-resource.mjs"), RESOURCE_HELPER_SOURCE, "utf8");
  return {
    AGENTRELAY_GATEWAY_BASE_URL: context.resourceAccess.gatewayBaseUrl,
    AGENTRELAY_GRANT_ID: context.accessGrant.id,
  };
}

const RESOURCE_HELPER_SOURCE = `const [operation, resource] = process.argv.slice(2);
if (operation !== "read" || !resource) { console.error("usage: agentrelay-resource read <logical-resource-handle>"); process.exit(2); }
const baseUrl = process.env.AGENTRELAY_GATEWAY_BASE_URL;
const grantId = process.env.AGENTRELAY_GRANT_ID;
if (!baseUrl || !grantId) { console.error("AgentRelay resource access is not configured for this run"); process.exit(2); }
const url = new URL("/api/middleware/resources/" + encodeURIComponent(resource), baseUrl);
const response = await fetch(url, { headers: { "X-AgentRelay-Grant": grantId } });
if (!response.ok) { console.error("Resource access denied: " + response.status); process.exit(response.status === 403 ? 3 : 1); }
process.stdout.write(await response.text());
`;

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("AGENT_RESULT_INVALID: Agent response must be a single JSON object");
  }
}
