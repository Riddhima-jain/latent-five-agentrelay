import { describe, expect, it } from "vitest";
import type { ProtectedResourceReader } from "../domain/ports.js";
import { CodexAgentAdapter, workflowRunnerId } from "./codex-agent-adapter.js";
import type { AgentRunner, RunnerRequest } from "../types.js";
import type { AgentTask } from "../domain/task.js";
import type { ExecutionContext } from "../domain/ports.js";

const task: AgentTask = {
  id: "research", sessionId: "workflow-1", title: "Market Research", requiredCapability: "market_research", requiredPermissions: ["read"],
  dependsOn: [], status: "running", attempt: 1, maxAttempts: 2, createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
};
const context: ExecutionContext = {
  sessionId: "workflow-1", taskId: "research", goal: "Recover sales", constraints: ["No external action"],
  allowedResources: ["market/market-report.json"], dependencyEvidence: [], accessGrantId: "opaque-test-grant",
};

function runnerWith(output: string) {
  const requests: RunnerRequest[] = [];
  const runner: AgentRunner = {
    async run(request) { requests.push(request); return { output, threadId: "workflow-thread", usage: null }; },
    async cancel() { return false; }, async isAvailable() { return true; },
  };
  return { runner, requests };
}
const resources: ProtectedResourceReader = { async readResource(input) {
  expect(input).toEqual({ grantId: "opaque-test-grant", resource: "market/market-report.json" });
  return { content: '{"observation":"Demand declined"}', contentType: "application/json", sourceRef: "resource://market/market-report.json" };
} };

describe("CodexAgentAdapter", () => {
  it("uses a new workflow-scoped session, provides only the capsule, and validates the response", async () => {
    const { runner, requests } = runnerWith(JSON.stringify({ summary: "Demand declined", evidence: [], proposedActions: [] }));
    const adapter = new CodexAgentAdapter(runner, [{ agentId: "research-agent", workspacePath: "/tmp/research" }], resources);
    await expect(adapter.execute("research-agent", task, context)).resolves.toMatchObject({ summary: "Demand declined" });
    expect(requests[0]).toMatchObject({ threadId: null, workspacePath: "/tmp/research", agentId: workflowRunnerId("workflow-1:research-agent") });
    expect(requests[0]?.prompt).toContain('"sourceRef":"resource://market/market-report.json"');
    expect(requests[0]?.prompt).not.toContain("opaque-test-grant");
    expect(requests[0]?.prompt).not.toContain("Playground");
  });

  it("reuses a thread only for the same workflow participant", async () => {
    const { runner, requests } = runnerWith(JSON.stringify({ summary: "ok", evidence: [], proposedActions: [] }));
    const adapter = new CodexAgentAdapter(runner, [{ agentId: "research-agent", workspacePath: "/tmp/research" }], resources);
    await adapter.execute("research-agent", task, context);
    await adapter.execute("research-agent", task, context);
    await adapter.execute("research-agent", { ...task, sessionId: "workflow-2" }, { ...context, sessionId: "workflow-2" });
    expect(requests.map((request) => request.threadId)).toEqual([null, "workflow-thread", null]);
    expect(requests[2]?.prompt).not.toContain("workflow-1");
  });

  it("fails closed when Codex returns prose or a malformed structured result", async () => {
    const { runner } = runnerWith("Here is my answer: {});");
    const adapter = new CodexAgentAdapter(runner, [{ agentId: "research-agent", workspacePath: "/tmp/research" }], resources);
    await expect(adapter.execute("research-agent", task, context)).rejects.toThrow("AGENT_RESULT_INVALID");
  });

  it("fails closed when the JSON result omits a required field", async () => {
    const { runner } = runnerWith(JSON.stringify({ summary: "Incomplete", evidence: [] }));
    const adapter = new CodexAgentAdapter(runner, [{ agentId: "research-agent", workspacePath: "/tmp/research" }], resources);
    await expect(adapter.execute("research-agent", task, context)).rejects.toThrow("AGENT_RESULT_INVALID");
  });

  it("propagates an execution failure without manufacturing evidence", async () => {
    const runner: AgentRunner = {
      async run() { throw new Error("controlled runtime failure"); },
      async cancel() { return false; }, async isAvailable() { return true; },
    };
    const adapter = new CodexAgentAdapter(runner, [{ agentId: "research-agent", workspacePath: "/tmp/research" }], resources);
    await expect(adapter.execute("research-agent", task, context)).rejects.toThrow("controlled runtime failure");
  });
});
