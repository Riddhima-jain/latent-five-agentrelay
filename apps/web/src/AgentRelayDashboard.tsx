import { useEffect, useState } from "react";
import { api } from "./api";
import type { RelaySession, RelayTask } from "./types";

const relaySessionStorageKey = "agentrelay.activeSessionId";

const emptySession: RelaySession = {
  id: "not-started", traceId: "not-started", title: "Workflow Overview", goal: "", status: "running", startedAt: new Date().toISOString(),
  tasks: [
    { id: "research", title: "Market Research", agentId: "research-agent", agentName: "Market Research Agent", status: "waiting", dependsOn: [], summary: "Starts when a workflow is created." },
    { id: "finance", title: "Financial Analysis", agentId: "finance-agent", agentName: "Financial Analysis Agent", status: "waiting", dependsOn: [], summary: "Starts when a workflow is created." },
    { id: "strategy", title: "Strategy", agentId: "strategy-agent", agentName: "Strategy Agent", status: "waiting", dependsOn: ["research", "finance"], summary: "Waits for accepted research and finance evidence." },
    { id: "outreach", title: "Outreach", agentId: "outreach-agent", agentName: "Outreach Agent", status: "waiting", dependsOn: ["strategy"], summary: "Protected external action remains blocked until approval." },
  ],
  approval: null,
  trace: [],
};

const evidence = [
  ["Market Report Q2 2025", "McKinsey & Company", "PDF", "document"],
  ["Industry Trends 2025", "Gartner", "Web", "web"],
  ["Competitor Benchmark", "SimilarWeb", "Web", "web"],
  ["Financial Statements FY24", "Acme Corp", "XLSX", "sheet"],
  ["Earnings Call Transcript", "Acme Corp Q4 FY24", "PDF", "document"],
] as const;

const suggestedGoals = [
  "Investigate a decline in product sales and recommend a response.",
  "Review a proposed pricing change and assess its likely impact.",
  "Prepare a customer outreach strategy using the available evidence.",
] as const;

function TaskIcon({ id }: { id: string }) {
  return <span className={`workflow-icon workflow-icon-${id}`}>{id === "research" ? "⌕" : id === "finance" ? "▥" : id === "strategy" ? "◎" : "✉"}</span>;
}

function formatClock(value?: string) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

function WorkflowCard({ task }: { task: RelayTask }) {
  const complete = task.status === "completed";
  const running = task.status === "running";
  return (
    <article className={`workflow-card workflow-card-${task.status}`}>
      <div className="workflow-card-heading"><TaskIcon id={task.id} /><div><h2>{task.title}</h2><span className={`workflow-state workflow-state-${task.status}`}>{complete ? "● Completed" : running ? "◌ Running" : task.status === "approval_required" ? "! Approval required" : task.status === "failed" || task.status === "denied" ? "× " + task.status : "⊖ Waiting"}</span></div></div>
      <p>{task.summary}</p>
      <dl className="workflow-card-meta">
        <div><dt>Started</dt><dd>{formatClock(task.startedAt)}</dd></div>
        {complete && <><div><dt>Completed</dt><dd>{formatClock(task.completedAt)}</dd></div><div><dt>Duration</dt><dd>{task.durationMs === undefined ? "—" : task.durationMs < 60_000 ? `${Math.max(1, Math.round(task.durationMs / 1000))}s` : `${Math.round(task.durationMs / 60_000)}m`}</dd></div></>}
        {running && <div><dt>State</dt><dd>Agent running<span className="mini-progress"><i /></span></dd></div>}
        {(task.status === "waiting" || task.status === "approval_required") && <div><dt>Reason</dt><dd>{task.status === "approval_required" ? "Awaiting approval" : "Dependency blocked"}</dd></div>}
      </dl>
    </article>
  );
}

export default function AgentRelayDashboard({ runtimeReady }: { runtimeReady: boolean }) {
  const [session, setSession] = useState(emptySession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<RelaySession[]>([]);
  const [scenario, setScenario] = useState<"normal" | "timeout" | "denial">("normal");
  const [goal, setGoal] = useState("");
  const [showComposer, setShowComposer] = useState(true);

  useEffect(() => {
    void api.listRelaySessions().then((history) => {
      setSessions(history.sessions);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => {
    if (!["running"].includes(session.status) || session.id === "not-started") return;
    const timer = window.setInterval(() => {
      void api.relaySession(session.id).then(({ session: value }) => {
        setSession(value);
        setSessions((current) => current.map((item) => item.id === value.id ? value : item));
      }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [session.id, session.status]);

  const createWorkflow = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.createRelaySession({ goal: goal.trim(), scenario });
      setSession(result.session);
      setShowComposer(false);
      setSessions((current) => [result.session, ...current.filter((item) => item.id !== result.session.id)]);
      window.localStorage.setItem(relaySessionStorageKey, result.session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const openWorkflow = async (id: string) => {
    setBusy(true); setError(null);
    try {
      const result = await api.relaySession(id);
      setSession(result.session);
      setShowComposer(false);
      window.localStorage.setItem(relaySessionStorageKey, id);
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
      setSession((await api.decideApproval(session.approval.id, decision)).session);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  };

  return (
    <div className="relay-page relay-reference-page">
      {showComposer ? <>
        <section className="workflow-start-shell" aria-labelledby="workflow-start-title">
          <div className="workflow-start-copy"><span className="workflow-start-eyebrow">Agent fleet orchestration</span><h1 id="workflow-start-title">Start a new workflow</h1><p>Describe the business problem you want the agent fleet to investigate. AgentRelay will coordinate research, analysis, strategy, and protected outreach.</p></div>
          {!runtimeReady && <div className="config-banner"><span>!</span><div><strong>Agent Runtime configuration required</strong><p>Configure Ark or Gemini and ensure Codex is available before starting a real workflow.</p></div></div>}
          {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
          <label className="workflow-goal-label" htmlFor="workflow-goal">What would you like the agent fleet to investigate?</label>
          <textarea id="workflow-goal" className="workflow-goal-input" value={goal} maxLength={2000} rows={5} placeholder="Sales for our new product have dropped. Investigate why and recommend what we should do." onChange={(event) => setGoal(event.target.value)} />
          <div className="workflow-goal-footer"><span>{goal.length.toLocaleString()} / 2,000</span><button className="button button-primary workflow-start-button" disabled={busy || !runtimeReady || !goal.trim()} onClick={createWorkflow}>{busy ? "Starting workflow…" : "Start AgentRelay Workflow →"}</button></div>
          <div className="suggested-goals"><span>Try a suggestion</span><div>{suggestedGoals.map((suggestion) => <button key={suggestion} type="button" onClick={() => setGoal(suggestion)}>{suggestion}</button>)}</div></div>
          <p className="workflow-scope-note"><strong>Demo scope:</strong> workflows are grounded in the committed sales-recovery fixtures so judges can reproduce the same evidence safely.</p>
          <details className="scenario-controls"><summary>Demo scenario <span>Optional controlled behavior</span></summary><label htmlFor="workflow-scenario">Scenario</label><select id="workflow-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as typeof scenario)}><option value="normal">Normal workflow</option><option value="timeout">Timeout and retry</option><option value="denial">Policy denial</option></select><p>These controls exercise real middleware paths; they do not replace agent execution with hard-coded results.</p></details>
        </section>
        <section className="workflow-history" aria-labelledby="workflow-history-title"><header><div><h2 id="workflow-history-title">Previous workflows</h2><p>Reopen a persisted session and continue from its latest state.</p></div><span>{sessions.length} {sessions.length === 1 ? "workflow" : "workflows"}</span></header>{sessions.length ? <div className="workflow-history-list">{sessions.map((item) => <button key={item.id} className="workflow-history-row" disabled={busy} onClick={() => void openWorkflow(item.id)}><span className={`history-status history-status-${item.status}`} aria-hidden="true"/><span className="history-goal"><strong>{item.goal || "Untitled workflow"}</strong><small>{item.id}</small></span><span className="history-meta"><strong>{item.status.replaceAll("_", " ")}</strong><small>{new Date(item.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></span><span className="history-open">Open →</span></button>)}</div> : <div className="workflow-history-empty"><strong>No workflows yet</strong><p>Your completed and in-progress sessions will appear here.</p></div>}</section>
      </> : <>
      <header className="relay-hero reference-hero">
        <div><h1>Workflow Overview</h1><div className="session-line">Session: <strong>{session.id}</strong><button aria-label="Copy session ID" onClick={() => void navigator.clipboard?.writeText(session.id)}>▢</button><span className={`active-badge active-badge-${session.status}`}>● {session.status.replaceAll("_", " ")}</span></div></div>
        <dl className="session-metadata"><div><dt>Started</dt><dd>{new Date(session.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd></div><div><dt>Triggered by</dt><dd>User request</dd></div><div><dt>Run mode</dt><dd>Semi-Autonomous</dd></div></dl>
        <div className="workflow-header-actions"><button className="button button-outline" onClick={() => { setGoal(""); setScenario("normal"); setShowComposer(true); }}>← All workflows</button><button className="button button-primary" onClick={() => { setGoal(""); setScenario("normal"); setShowComposer(true); }}>+ New Workflow</button></div>
      </header>
      <p className="workflow-active-goal">{session.goal}</p>
      {!runtimeReady && <div className="config-banner"><span>!</span><div><strong>Agent Runtime configuration required</strong><p>Configure Ark or Gemini and ensure Codex is available before starting a real workflow.</p></div></div>}
      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
      <section className="workflow-card-grid">{session.tasks.map((task) => <WorkflowCard key={task.id} task={task} />)}</section>
      <section className="relay-detail-grid">
        <article className="reference-panel evidence-panel">
          <header><h2>Evidence</h2><span className="soft-badge">{session.evidence?.length ?? evidence.length} records</span></header>
          <div className="evidence-list">{session.evidence?.length ? session.evidence.map((record) => <div className="evidence-row" key={record.id}><span className="evidence-icon">▤</span><div><strong>{record.claim}</strong><small>{record.sourceRefs.join(" · ")}</small></div><div><b>{record.status}</b><small>{record.taskId}</small></div></div>) : evidence.map(([title, source, kind, icon]) => <div className="evidence-row" key={title}><span className="evidence-icon">{icon === "web" ? "◎" : icon === "sheet" ? "▦" : "▤"}</span><div><strong>{title}</strong><small>{source}</small></div><div><b>Preview</b><small>{kind}</small></div></div>)}</div>
          <button className="panel-link">View all evidence →</button>
        </article>
        <article className="reference-panel decision-panel">
          <header><h2>Automation Decision</h2><span className="soft-badge">Policy: Standard</span></header>
          {session.approval ? <><div className="decision-title"><span>!</span><strong>{session.approval.decision.replaceAll("_", " ")}</strong></div><p>{session.approval.rationale}</p><h3>Action Summary</h3><dl className="action-summary"><div><dt>Action</dt><dd>{session.approval.actionType}</dd></div><div><dt>Agent</dt><dd>Outreach Agent</dd></div><div><dt>Affected system</dt><dd>Email executor</dd></div><div><dt>Recipients</dt><dd>{session.approval.recipient}</dd></div><div><dt>Payload hash</dt><dd><code>{session.approval.actionHash.slice(0, 12)}…</code></dd></div></dl><div className="approval-request"><div className="requester"><span>SA</span><p><strong>Strategy Agent</strong><small>{session.approval.status}</small></p></div><div className="approval-buttons"><button className="approve-button" disabled={busy || session.approval.status !== "pending"} onClick={() => decide("approve")}>✓ Approve</button><button className="deny-button" disabled={busy || session.approval.status !== "pending"} onClick={() => decide("deny")}>× Deny</button></div></div>{session.receipts?.map((receipt) => <div className="execution-receipt" key={receipt.externalReference}><strong>✓ Executed via {receipt.provider}</strong><code>{receipt.externalReference}</code><small>{new Date(receipt.acceptedAt).toLocaleString()}</small></div>)}</> : <div className={`decision-empty decision-empty-${session.status}`}><strong>{session.status === "degraded" ? "Action denied by policy" : session.status === "failed" ? "Workflow failed" : "No decision pending"}</strong><p>Policy events and failure reasons are recorded in the trace.</p></div>}
        </article>
        <article className="reference-panel trace-panel">
          <header><h2>Trace Timeline</h2><button className="filter-button">All Events⌄</button></header>
          <div className="reference-trace">{[...session.trace].reverse().map((event) => <div className={`trace-row trace-${event.tone}`} key={event.id}><span className="trace-node"/><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><p><strong>{event.type}</strong><small>{event.summary}</small></p></div>)}</div>
          <button className="panel-link">View full trace →</button>
        </article>
      </section>
      </>}
    </div>
  );
}
