import { SALES_RECOVERY_AGENTS, SALES_RECOVERY_TASKS } from "../domain/demo-workflow.js";
import type { AgentTask } from "../domain/task.js";
import { Coordinator, type CoordinatorSnapshot, type FakeAgentExecutor } from "./coordinator.js";

class DemoAgentExecutor implements FakeAgentExecutor {
  async execute(agentId: string, task: AgentTask): Promise<void> {
    console.log(`  mock execution: ${agentId} -> ${task.title}`);
  }
}

function printSnapshot(label: string, snapshot: CoordinatorSnapshot): void {
  console.log(`\n${label}`);
  console.table(
    snapshot.tasks.map((task) => ({
      task: task.title,
      status: task.status.toUpperCase(),
      agent: task.assignedAgentId ?? "-",
      attempt: task.attempt,
    })),
  );
  console.log(`Ready to run: ${snapshot.readyTaskIds.join(", ") || "none"}`);
  if (snapshot.blockedByFailedDependencyTaskIds.length > 0) {
    console.log(`Blocked by failure: ${snapshot.blockedByFailedDependencyTaskIds.join(", ")}`);
  }
}

const coordinator = new Coordinator(
  SALES_RECOVERY_TASKS,
  SALES_RECOVERY_AGENTS,
  new DemoAgentExecutor(),
);
const started = coordinator.start("demo-session");
if (!started.started) {
  console.error("Workflow failed validation:", started.errors);
  process.exitCode = 1;
} else {
  printSnapshot("After start", started.snapshot);
  printSnapshot("After tick 1 (Research + Finance)", await coordinator.tick());
  printSnapshot("After tick 2 (Strategy)", await coordinator.tick());
  printSnapshot("After tick 3 (Outreach)", await coordinator.tick());
}
