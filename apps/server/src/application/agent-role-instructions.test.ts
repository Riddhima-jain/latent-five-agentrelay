import { describe, expect, it } from "vitest";
import { DEMO_AGENT_ROLE_INSTRUCTIONS } from "./agent-role-instructions.js";

describe("DEMO_AGENT_ROLE_INSTRUCTIONS", () => {
  it("gives each real demo Agent a bounded specialist role", () => {
    expect(DEMO_AGENT_ROLE_INSTRUCTIONS.research).toContain("Market Research Agent");
    expect(DEMO_AGENT_ROLE_INSTRUCTIONS.finance).toContain("Finance Agent");
    expect(DEMO_AGENT_ROLE_INSTRUCTIONS.strategy).toContain("Strategy Agent");
    expect(DEMO_AGENT_ROLE_INSTRUCTIONS.outreach).toContain("SEND_EMAIL");
  });

  it("keeps resource and automation authority in AgentRelay", () => {
    expect(DEMO_AGENT_ROLE_INSTRUCTIONS.research).toContain("explicitly granted");
    expect(DEMO_AGENT_ROLE_INSTRUCTIONS.finance).toContain("Do not decide");
    expect(DEMO_AGENT_ROLE_INSTRUCTIONS.strategy).toContain("Do not classify");
    expect(DEMO_AGENT_ROLE_INSTRUCTIONS.outreach).toContain("Do not bypass");
  });
});
