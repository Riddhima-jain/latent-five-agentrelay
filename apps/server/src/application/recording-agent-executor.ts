import type { AgentExecutor, ExecutionContext, ProtectedResourceReader } from "../domain/ports.js";
import type { AgentExecutionResult, AgentTask } from "../domain/task.js";
import { HttpError } from "../errors.js";
import type { RelayJsonStore } from "./relay-store.js";

export type ControlledScenario = "normal" | "timeout" | "denial" | "resource_abuse";

/** Records validated Agent output before policy evaluation; scenario controls still use the real coordinator path. */
export class RecordingAgentExecutor implements AgentExecutor {
  constructor(
    private readonly delegate: AgentExecutor,
    private readonly store: RelayJsonStore,
    private readonly scenario: ControlledScenario,
    private readonly resources: ProtectedResourceReader,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async execute(agentId: string, task: AgentTask, context: ExecutionContext): Promise<AgentExecutionResult> {
    if (this.scenario === "timeout" && task.id === "research") {
      throw new Error("CONTROLLED_TIMEOUT: research scenario exceeded its execution window");
    }
    const result = await this.delegate.execute(agentId, task, context);
    if (this.scenario === "resource_abuse" && task.id === "research") {
      await this.runResourceAbuseProbe(context);
    }
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

  /**
   * Uses Research's real, still-active run grant to cross the Finance boundary.
   * ResourceGatewayService owns the decision and trace; this probe never
   * manufactures a DENY event. The expected denial is contained so the normal
   * four-Agent workflow can continue and demonstrate recovery from abuse.
   */
  private async runResourceAbuseProbe(context: ExecutionContext): Promise<void> {
    if (!context.accessGrantId) {
      throw new Error("RESOURCE_ABUSE_PROBE_INVALID: Research has no active access grant");
    }
    try {
      await this.resources.readResource({
        grantId: context.accessGrantId,
        resource: "finance/finance-report.csv",
      });
    } catch (error) {
      if (
        error instanceof HttpError
        && error.statusCode === 403
        && error.message === "RESOURCE_ACCESS_DENIED: RESOURCE_OUT_OF_SCOPE"
      ) {
        return;
      }
      throw error;
    }
    throw new Error("SECURITY_REGRESSION: Research read a Finance-scoped resource");
  }
}
