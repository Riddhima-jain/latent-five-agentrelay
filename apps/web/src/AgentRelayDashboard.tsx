import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { RelaySession, RelayTask } from "./types";

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const relaySessionStorageKey = "agentrelay.activeSessionId";

const demoSession: RelaySession = {
  id: "STR-2025-05-14-001", traceId: "trace-8f31a2", title: "Workflow Overview", status: "awaiting_approval", startedAt: ago(900),
  tasks: [
    { id: "research", title: "Market Research", agentId: "research-agent", agentName: "Market Research Agent", status: "completed", dependsOn: [], durationMs: 360_000, summary: "Collected market data, trends, and competitive landscape." },
    { id: "finance", title: "Financial Analysis", agentId: "finance-agent", agentName: "Financial Analysis Agent", status: "completed", dependsOn: [], durationMs: 480_000, summary: "Analyzed financials, KPIs, and growth metrics." },
    { id: "strategy", title: "Strategy", agentId: "strategy-agent", agentName: "Strategy Agent", status: "running", dependsOn: ["research", "finance"], durationMs: 0, summary: "Synthesizing insights and building recommendations." },
    { id: "outreach", title: "Outreach", agentId: "outreach-agent", agentName: "Outreach Agent", status: "waiting", dependsOn: ["strategy"], summary: "Waiting for strategy approval before drafting outreach." },
  ],
  approval: { id: "approval-001", actionId: "action-send-email-001", actionHash: "sha256:8d7f…a921", status: "pending", decision: "REQUIRE_APPROVAL", actionType: "SEND_EMAIL", recipient: "24 external contacts", subject: "Draft Outreach Emails", body: "Create tailored recovery messages using the approved strategy and verified evidence.", rationale: "The next action writes outbound emails to external recipients and requires human approval." },
  trace: [
    { id: "e1", type: "Session Started", timestamp: ago(900), summary: "STR-2025-05-14-001", tone: "neutral" },
    { id: "e2", type: "Workflow Triggered", timestamp: ago(885), summary: "By Strategy Agent", tone: "success" },
    { id: "e3", type: "Market Research Agent", timestamp: ago(540), summary: "Completed market research", tone: "success" },
    { id: "e4", type: "Evidence Ingestor", timestamp: ago(370), summary: "Ingested 5 new sources", tone: "neutral" },
    { id: "e5", type: "Financial Analysis Agent", timestamp: ago(364), summary: "Completed financial analysis", tone: "neutral" },
    { id: "e6", type: "Strategy Agent", timestamp: ago(359), summary: "Started strategy synthesis", tone: "warning" },
  ],
};

const evidence = [
  ["Market Report Q2 2025", "McKinsey & Company", "PDF", "document"],
  ["Industry Trends 2025", "Gartner", "Web", "web"],
  ["Competitor Benchmark", "SimilarWeb", "Web", "web"],
  ["Financial Statements FY24", "Acme Corp", "XLSX", "sheet"],
  ["Earnings Call Transcript", "Acme Corp Q4 FY24", "PDF", "document"],
] as const;

function TaskIcon({ id }: { id: string }) {
  return <span className={`workflow-icon workflow-icon-${id}`}>{id === "research" ? "⌕" : id === "finance" ? "▥" : id === "strategy" ? "◎" : "✉"}</span>;
}

function WorkflowCard({ task, index }: { task: RelayTask; index: number }) {
  const complete = task.status === "completed";
  const running = task.status === "running";
  return (
    <article className={`workflow-card workflow-card-${task.status}`}>
      <div className="workflow-card-heading"><TaskIcon id={task.id} /><div><h2>{task.title}</h2><span className={`workflow-state workflow-state-${task.status}`}>{complete ? "● Completed" : running ? "◌ Running" : "⊖ Blocked"}</span></div></div>
      <p>{task.summary}</p>
      <dl className="workflow-card-meta">
        <div><dt>{task.status === "waiting" ? "Blocked at" : "Started"}</dt><dd>{index === 0 ? "9:12 AM" : index === 1 ? "9:18 AM" : "9:26 AM"}</dd></div>
        {complete && <><div><dt>Completed</dt><dd>{index === 0 ? "9:18 AM" : "9:26 AM"}</dd></div><div><dt>Duration</dt><dd>{Math.round((task.durationMs ?? 0) / 60000)}m</dd></div></>}
        {running && <><div><dt>ETA</dt><dd>9:34 AM</dd></div><div><dt>Progress</dt><dd>62%<span className="mini-progress"><i /></span></dd></div></>}
        {task.status === "waiting" && <div><dt>Reason</dt><dd>Awaiting approval</dd></div>}
      </dl>
    </article>
  );
}

export default function AgentRelayDashboard() {
  const [session, setSession] = useState(demoSession);
  const [fixtureMode, setFixtureMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedId = window.localStorage.getItem(relaySessionStorageKey) ?? "demo";
    void api.relaySession(savedId).then(({ session: value }) => setSession(value)).catch(async (reason) => {
      if (reason instanceof ApiError && reason.status === 404 && savedId !== "demo") {
        window.localStorage.removeItem(relaySessionStorageKey);
        try { setSession((await api.relaySession()).session); }
        catch (fallbackReason) { setError(fallbackReason instanceof Error ? fallbackReason.message : String(fallbackReason)); }
      } else if (reason instanceof ApiError && reason.status === 404) setFixtureMode(true);
      else setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);

  const createWorkflow = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.createRelaySession();
      setSession(result.session);
      window.localStorage.setItem(relaySessionStorageKey, result.session.id);
      setFixtureMode(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approve" | "deny") => {
    if (!session.approval) return;
    setBusy(true); setError(null);
    try {
      if (!fixtureMode) setSession((await api.decideApproval(session.approval.id, decision)).session);
      else setSession((current) => ({ ...current, status: decision === "approve" ? "completed" : "degraded", approval: current.approval ? { ...current.approval, status: decision === "approve" ? "approved" : "denied" } : null, tasks: current.tasks.map((task) => task.id === "outreach" ? { ...task, status: decision === "approve" ? "completed" : "denied" } : task), trace: [...current.trace, { id: `fixture-${Date.now()}`, type: decision === "approve" ? "Approval Granted" : "Approval Denied", timestamp: new Date().toISOString(), summary: decision === "approve" ? "Protected action released" : "External write remains blocked", tone: decision === "approve" ? "success" : "danger" }] }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  };

  return (
    <div className="relay-page relay-reference-page">
      <header className="relay-hero reference-hero">
        <div><h1>Workflow Overview</h1><div className="session-line">Session: <strong>{session.id}</strong><button aria-label="Copy session ID" onClick={() => void navigator.clipboard?.writeText(session.id)}>▢</button><span className={`active-badge active-badge-${session.status}`}>● {session.status.replaceAll("_", " ")}</span></div></div>
        <dl className="session-metadata"><div><dt>Started</dt><dd>{new Date(session.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd></div><div><dt>Triggered by</dt><dd>Strategy Agent</dd></div><div><dt>Run mode</dt><dd>Semi-Autonomous</dd></div></dl>
        <div className="workflow-header-actions"><button className="button button-outline">View Session Details ↗</button><button className="button button-primary" disabled={busy} onClick={createWorkflow}>{busy ? "Starting…" : "+ New Workflow"}</button></div>
      </header>
      {fixtureMode && <div className="relay-fixture-banner"><strong>Preview data</strong> Live Relay endpoints are pending; approval controls affect this preview only.</div>}
      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
      <section className="workflow-card-grid">{session.tasks.map((task, index) => <WorkflowCard key={task.id} task={task} index={index} />)}</section>
      <section className="relay-detail-grid">
        <article className="reference-panel evidence-panel">
          <header><h2>Evidence</h2><span className="soft-badge">16 Sources</span></header>
          <div className="evidence-list">{evidence.map(([title, source, kind, icon]) => <div className="evidence-row" key={title}><span className="evidence-icon">{icon === "web" ? "◎" : icon === "sheet" ? "▦" : "▤"}</span><div><strong>{title}</strong><small>{source}</small></div><div><b>Verified</b><small>{kind}</small></div></div>)}</div>
          <button className="panel-link">View all evidence →</button>
        </article>
        <article className="reference-panel decision-panel">
          <header><h2>Automation Decision</h2><span className="soft-badge">Policy: Standard</span></header>
          {session.approval && <><div className="decision-title"><span>!</span><strong>{session.approval.decision.replaceAll("_", " ")}</strong></div><p>{session.approval.rationale}</p><h3>Action Summary</h3><dl className="action-summary"><div><dt>Action</dt><dd>Draft Outreach Emails</dd></div><div><dt>Agent</dt><dd>Outreach Agent</dd></div><div><dt>Affected Systems</dt><dd>Email Service (SMTP)</dd></div><div><dt>Recipients</dt><dd>{session.approval.recipient}</dd></div><div><dt>Confidence</dt><dd>87%</dd></div></dl><div className="approval-request"><div className="requester"><span>SA</span><p><strong>Strategy Agent</strong><small>Requested May 14, 2025 9:26 AM</small></p></div><div className="approval-buttons"><button className="approve-button" disabled={busy || session.approval.status !== "pending"} onClick={() => decide("approve")}>✓ Approve</button><button className="deny-button" disabled={busy || session.approval.status !== "pending"} onClick={() => decide("deny")}>× Deny</button></div></div></>}
        </article>
        <article className="reference-panel trace-panel">
          <header><h2>Trace Timeline</h2><button className="filter-button">All Events⌄</button></header>
          <div className="reference-trace">{[...session.trace].reverse().map((event) => <div className={`trace-row trace-${event.tone}`} key={event.id}><span className="trace-node"/><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><p><strong>{event.type}</strong><small>{event.summary}</small></p></div>)}</div>
          <button className="panel-link">View full trace →</button>
        </article>
      </section>
    </div>
  );
}
