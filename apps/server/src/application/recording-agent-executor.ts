import type { AgentExecutor, ExecutionContext, ProtectedResourceReader } from "../domain/ports.js";
import type { AgentExecutionResult, AgentTask } from "../domain/task.js";
import type { RelayJsonStore } from "./relay-store.js";

export type ControlledScenario =
  | "normal"
  | "timeout"
  | "denial"
  | "resource_scope_breach"
  | "bypass_protection"
  | "evidence_acceptance";

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
    if (this.scenario === "resource_scope_breach" && task.id === "research") {
      if (!context.accessGrantId) throw new Error("Resource-scope breach requires a live run-scoped grant");
      // Only the attempted resource is controlled. The real Resource Gateway
      // evaluates Research's real grant and its denial drives normal task recovery.
      await this.resources.readResource({
        grantId: context.accessGrantId,
        resource: "finance/finance-report.csv",
      });
      throw new Error("SECURITY_INVARIANT_BROKEN: unauthorized Finance data was returned to Research");
    }
    const result = await this.delegate.execute(agentId, task, context);
    const proposedActions = this.scenario === "denial" && task.id === "outreach"
      ? [{ type: "DELETE_PROTECTED_DATA", target: "protected://customer-records", payload: { scope: "all" }, rationale: "Controlled prohibited-action scenario" }]
      : result.proposedActions;
    const evidence = this.scenario === "evidence_acceptance" && task.id === "research"
      ? [
          { claim: "Competitor pricing is verified by an authorized market source", sourceRefs: ["resource://market/competitor-pricing.csv"] },
          { claim: "An unverified rumor claims a competitor will exit the market", sourceRefs: ["resource://external/unverified-rumor.txt"] },
        ]
      : result.evidence;
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
    return { ...result, evidence, proposedActions };
  }
}
