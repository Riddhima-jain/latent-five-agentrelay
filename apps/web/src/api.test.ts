import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("Relay browser API", () => {
  it("creates a controlled workflow using only the supported input", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ session: { id: "STR-1" } }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.createRelaySession({ goal: "Recover pipeline", scenario: "denial" });
    expect(fetchMock).toHaveBeenCalledWith("/api/relay/sessions", expect.objectContaining({ method: "POST", body: JSON.stringify({ goal: "Recover pipeline", scenario: "denial" }) }));
  });

  it("lists and safely encodes persisted session identifiers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.listRelaySessions();
    expect(fetchMock).toHaveBeenCalledWith("/api/relay/sessions", expect.any(Object));

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ session: {} }), { status: 200, headers: { "content-type": "application/json" } }));
    await api.relaySession("session/with spaces");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/relay/sessions/session%2Fwith%20spaces", expect.any(Object));
  });

  it("loads safe AgentRelay manifest summaries independently of a session", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ manifests: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.relayManifests();
    expect(fetchMock).toHaveBeenCalledWith("/api/relay/manifests", expect.any(Object));
  });

  it("surfaces server approval conflicts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Approval already decided" }), { status: 409, headers: { "content-type": "application/json" } })));
    await expect(api.decideApproval("approval-1", "approve")).rejects.toEqual(expect.objectContaining({ status: 409, message: "Approval already decided" }));
  });
});
