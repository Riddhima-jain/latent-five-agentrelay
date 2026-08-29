import type { AgentExecutor, ExecutionContext } from "../domain/ports.js";
import type { AgentExecutionResult, AgentTask } from "../domain/task.js";
import type { RelayJsonStore } from "./relay-store.js";

export type ControlledScenario = "normal" | "timeout" | "denial";

/** Records validated Agent output before policy evaluation; scenario controls still use the real coordinator path. */
export class RecordingAgentExecutor implements AgentExecutor {
  constructor(
    private readonly delegate: AgentExecutor,
    private readonly store: RelayJsonStore,
    private readonly scenario: ControlledScenario,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async execute(agentId: string, task: AgentTask, context: ExecutionContext): Promise<AgentExecutionResult> {
    if (this.scenario === "timeout" && task.id === "research") {
      throw new Error("CONTROLLED_TIMEOUT: research scenario exceeded its execution window");
    }
    const result = await this.delegate.execute(agentId, task, context);
    const proposedActions = this.scenario === "denial" && task.id === "outreach"
      ? [{ type: "DELETE_PROTECTED_DATA", target: "protected://customer-records", payload: { scope: "all" }, rationale: "Controlled prohibited-action scenario" }]
      : result.proposedActions;
    await this.store.saveTaskResult({ sessionId: task.sessionId, taskId: task.id, summary: result.summary, createdAt: this.now() });
    await Promise.all(proposedActions.map((action, index) => this.store.saveAction({
      id: `${task.sessionId}:${task.id}:action:${index + 1}`,
      sessionId: task.sessionId,
      taskId: task.id,
      producerAgentId: agentId,
      type: action.type,
      target: action.target,
      payload: action.payload,
      ...(action.rationale ? { rationale: action.rationale } : {}),
      createdAt: this.now(),
    })));
    return { ...result, proposedActions };
  }
}
