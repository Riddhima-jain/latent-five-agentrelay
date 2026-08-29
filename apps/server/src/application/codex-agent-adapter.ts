import { createHash } from "node:crypto";
import type { AgentExecutor, ExecutionContext } from "../domain/ports.js";
import type { AgentExecutionResult, AgentTask } from "../domain/task.js";
import type { AgentRunner } from "../types.js";
import type { ControlledFixtureProvider } from "./controlled-fixtures.js";
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
    private readonly fixtures: ControlledFixtureProvider,
  ) {
    for (const agent of agents) this.agents.set(agent.agentId, { ...agent });
  }

  async execute(agentId: string, task: AgentTask, context: ExecutionContext): Promise<AgentExecutionResult> {
    if (context.sessionId !== task.sessionId || context.taskId !== task.id) {
      throw new Error("Execution context does not match the workflow task");
    }
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Workflow agent is not registered: ${agentId}`);

    const materializedFixtures = await this.fixtures.materialize(agent.workspacePath, context.allowedResources);
    const sessionKey = `${context.sessionId}:${agentId}`;
    const response = await this.runner.run({
      // A unique runner identity prevents an Agent's normal Playground turn from
      // colliding with a workflow run, particularly for the container runner.
      agentId: workflowRunnerId(sessionKey),
      workspacePath: agent.workspacePath,
      prompt: buildWorkflowPrompt(task, context, materializedFixtures),
      threadId: this.workflowThreads.get(sessionKey) ?? null,
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
  materializedFixtures: readonly string[],
): string {
  return [
    "You are a workflow participant. Treat the following Context Capsule as the complete workflow context.",
    "Do not rely on prior conversations or instructions outside this prompt.",
    "You may inspect only the controlled fixture paths listed below. Do not execute external actions; propose them in the output only.",
    "Return exactly one JSON object, with no Markdown fences or commentary, matching:",
    '{"summary":"string","evidence":[{"claim":"string","sourceRefs":["string"]}],"proposedActions":[{"type":"string","target":"string","payload":{},"rationale":"string optional"}]}',
    "",
    `Current task: ${JSON.stringify({ id: task.id, title: task.title, requiredCapability: task.requiredCapability })}`,
    `Context Capsule: ${JSON.stringify({ goal: context.goal, constraints: context.constraints, dependencyEvidence: context.dependencyEvidence })}`,
    `Controlled fixture paths: ${JSON.stringify(materializedFixtures)}`,
  ].join("\n");
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("AGENT_RESULT_INVALID: Agent response must be a single JSON object");
  }
}
