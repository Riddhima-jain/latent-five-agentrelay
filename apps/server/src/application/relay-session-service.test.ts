import { describe, expect, it } from "vitest";
import { DemoRelaySessionService } from "./relay-session-service.js";

describe("DemoRelaySessionService", () => {
  const clock = () => "2026-08-29T12:00:00.000Z";

  it("projects the sales workflow with a server-derived approval gate", () => {
    const service = new DemoRelaySessionService(clock);
    const session = service.getSession("demo");

    expect(session.status).toBe("awaiting_approval");
    expect(session.tasks).toHaveLength(4);
    expect(session.tasks.find((task) => task.id === "outreach")?.status).toBe("approval_required");
    expect(session.approval).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      actionType: "SEND_EMAIL",
      status: "pending",
    });
    expect(session.approval?.actionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(session.trace.map((event) => event.id)).size).toBe(session.trace.length);
  });

  it("releases the bound action once and records execution", () => {
    const service = new DemoRelaySessionService(clock);
    const approvalId = service.getSession("demo").approval!.id;
    const approved = service.decideApproval(approvalId, "approve");

    expect(approved.status).toBe("completed");
    expect(approved.approval?.status).toBe("approved");
    expect(approved.tasks.find((task) => task.id === "outreach")?.status).toBe("completed");
    expect(approved.trace.map((event) => event.type)).toContain("action.executed");
    expect(() => service.decideApproval(approvalId, "approve")).toThrow(/already approved/);
  });

  it("keeps the external action blocked after denial", () => {
    const service = new DemoRelaySessionService(clock);
    const approvalId = service.getSession("demo").approval!.id;
    const denied = service.decideApproval(approvalId, "deny");

    expect(denied.status).toBe("degraded");
    expect(denied.approval?.status).toBe("denied");
    expect(denied.tasks.find((task) => task.id === "outreach")?.status).toBe("denied");
    expect(denied.trace.at(-1)?.type).toBe("approval.denied");
  });

  it("creates independent sessions with isolated approval lifecycles", () => {
    const ids = ["first-session-id", "second-session-id"];
    const service = new DemoRelaySessionService(clock, () => ids.shift()!);
    const first = service.createSession();
    const second = service.createSession();

    expect(first.id).not.toBe(second.id);
    expect(first.approval?.id).not.toBe(second.approval?.id);

    service.decideApproval(first.approval!.id, "approve");
    expect(service.getSession(first.id).status).toBe("completed");
    expect(service.getSession(second.id).status).toBe("awaiting_approval");
    expect(service.getSession(second.id).approval?.status).toBe("pending");
  });
});
