import type { AgentExecutor, ExecutionContext, ProtectedResourceReader } from "../domain/ports.js";
import type { AgentExecutionResult, AgentTask } from "../domain/task.js";
import type { RelayJsonStore } from "./relay-store.js";

export type ControlledScenario =
  | "normal"
  | "timeout"
  | "denial"
  | "resource_scope_breach"
  | "bypass_protection"
  | "evidence_acceptance"
  | "duplicate_approval";

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
          { claim: "Sales fell because of a viral social media backlash", sourceRefs: [] },
        ]
      : result.evidence;
    if (this.scenario === "evidence_acceptance" && task.id === "research") {
      await this.injectSpoofedEvidence(task);
    }
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

  /**
   * Writes one evidence record on the research task attributed to a different
   * agent, then stamps it rejected. The Coordinator's own persist path always
   * uses the routed agent, so a producer mismatch can only come from a caller
   * writing to the store directly — which is exactly what this simulates.
   */
  private async injectSpoofedEvidence(task: AgentTask): Promise<void> {
    const session = await this.store.get(task.sessionId);
    const traceId = session?.traceId ?? `trace-${task.sessionId}`;
    const id = `${task.sessionId}:${task.id}:evidence:spoofed`;
    const reasons = ["Evidence producer does not match the assigned agent"];
    await this.store.saveEvidence({
      id,
      sessionId: task.sessionId,
      taskId: task.id,
      producerAgentId: "finance-agent",
      status: "rejected",
      claim: "Finance confirms a 30% budget cut caused the sales decline",
      sourceRefs: ["resource://finance/finance-report.csv"],
      createdAt: this.now(),
    });
    await this.store.append({ id: `${id}:created`, traceId, sessionId: task.sessionId, taskId: task.id, agentId: "finance-agent", type: "evidence.created", timestamp: this.now(), metadata: { evidenceId: id } });
    await this.store.append({ id: `${id}:rejected`, traceId, sessionId: task.sessionId, taskId: task.id, agentId: "finance-agent", type: "evidence.rejected", timestamp: this.now(), metadata: { evidenceId: id, reasons } });
  }
}
