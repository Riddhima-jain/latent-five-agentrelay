import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { RelayAgentManifestView, RelayRecommendationView, RelayResourceAccessEvent, RelaySession, RelayTask } from "./types";

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

function FleetMap({ tasks }: { tasks: RelayTask[] }) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const roots = tasks.filter((task) => task.dependsOn.length === 0);
  const stages = tasks.filter((task) => task.dependsOn.length > 0);
  const statusLabel = (task: RelayTask) => task.status === "waiting" ? "Idle" : task.status.replaceAll("_", " ");
  const renderAgent = (task: RelayTask) => (
    <article className={`fleet-agent fleet-agent-${task.status}`} key={task.id}>
      <span className="fleet-agent-status" aria-hidden="true" />
      <div><strong>{task.agentName}</strong><small>{statusLabel(task)}</small></div>
      <p>{task.summary}</p>
      <span className="fleet-dependency">{task.dependsOn.length ? `After ${task.dependsOn.map((id) => taskById.get(id)?.title ?? id).join(" + ")}` : "Starts in parallel"}</span>
    </article>
  );

  return (
    <section className="fleet-map" aria-labelledby="fleet-map-title">
      <header><div><span className="resource-panel-eyebrow">Live execution topology</span><h2 id="fleet-map-title">Agent Fleet Map</h2><p>Dependencies show how work and evidence move through the fleet.</p></div><span className="fleet-live-count">{tasks.filter((task) => task.status === "running").length} active</span></header>
      <div className="fleet-flow">
        <article className="fleet-coordinator"><span>AR</span><div><strong>Workflow Coordinator</strong><small>Routes work, evidence and approvals</small></div></article>
        <div className="fleet-connector fleet-connector-down" aria-hidden="true" />
        <div className="fleet-parallel" aria-label="Parallel starting agents">{roots.map(renderAgent)}</div>
        {stages.map((task) => <div className="fleet-stage" key={task.id}><div className="fleet-connector fleet-connector-down" aria-hidden="true" />{renderAgent(task)}</div>)}
      </div>
    </section>
  );
}

function PermissionSummary({ manifest }: { manifest: RelayAgentManifestView }) {
  return <article className="permission-summary"><header><span className={`permission-agent-state ${manifest.runnable ? "permission-agent-ready" : "permission-agent-unavailable"}`} /><div><strong>{manifest.name}</strong><small>Starter Kit Agent · {manifest.agentId}</small></div></header><dl><div><dt>Capabilities</dt><dd>{manifest.capabilities.join(", ") || "None registered"}</dd></div><div><dt>Allowed tools</dt><dd>{manifest.allowedTools.join(", ") || "No protected tools"}</dd></div><div><dt>Resource scopes</dt><dd>{manifest.resourceScopes.join(", ") || "No raw resource access"}</dd></div></dl></article>;
}

function ResourceAccessRow({ event }: { event: RelayResourceAccessEvent }) {
  const allowed = event.decision === "ALLOW";
  return <div className={`resource-access-row resource-access-${event.decision.toLowerCase()}`}><span className="resource-decision-icon" aria-label={allowed ? "Allowed" : "Denied"}>{allowed ? "✓" : "×"}</span><div className="resource-access-agent"><strong>{event.agentName}</strong><small>{event.agentId} · {event.taskId}</small></div><div className="resource-access-target"><code>{event.tool}</code><strong>{event.resource}</strong></div><div className="resource-access-result"><strong>{allowed ? "Allowed" : "Denied"}</strong><small>{event.reason.replaceAll("_", " ")}</small></div><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>;
}

function RecommendationCard({ recommendation }: { recommendation: RelayRecommendationView }) {
  return <article className="recommendation-card"><header><span>Recommendation only</span><code>{recommendation.actionType}</code></header><p>{recommendation.summary}</p><ul>{recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><footer><span>{recommendation.supportingEvidenceIds.length} supporting evidence {recommendation.supportingEvidenceIds.length === 1 ? "record" : "records"}</span><strong>Execution blocked</strong></footer></article>;
}

export default function AgentRelayDashboard({ runtimeReady }: { runtimeReady: boolean }) {
  const [session, setSession] = useState(emptySession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<RelaySession[]>([]);
  const [scenario, setScenario] = useState<"normal" | "timeout" | "denial">("normal");
  const [goal, setGoal] = useState("");
  const [showComposer, setShowComposer] = useState(true);
  const [dismissedApprovalId, setDismissedApprovalId] = useState<string | null>(null);
  const decisionPanelRef = useRef<HTMLElement>(null);

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

  const focusDecision = () => {
    decisionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    decisionPanelRef.current?.focus({ preventScroll: true });
  };

  const pendingApproval = session.approval?.status === "pending" ? session.approval : null;

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
      {pendingApproval && dismissedApprovalId !== pendingApproval.id && <aside className="approval-notification" role="status" aria-live="polite"><button className="approval-notification-close" aria-label="Dismiss approval notification" onClick={() => setDismissedApprovalId(pendingApproval.id)}>×</button><span className="approval-notification-icon">!</span><div><strong>Strategy is ready</strong><p>Outreach requires your approval before it can continue.</p><button onClick={focusDecision}>Review decision →</button></div></aside>}
      <FleetMap tasks={session.tasks} />
      <section className="workflow-card-grid">{session.tasks.map((task) => <WorkflowCard key={task.id} task={task} />)}</section>
      <section className="resource-governance-panel" aria-labelledby="resource-access-title">
        <header><div><span className="resource-panel-eyebrow">Deterministic control plane</span><h2 id="resource-access-title">Tool &amp; Resource Access</h2><p>Run-scoped permissions govern which protected resources each Agent may read.</p></div><span className="resource-event-count">{session.resourceAccessEvents?.length ?? 0} access events</span></header>
        {session.agentManifests?.length ? <div className="permission-summary-grid">{session.agentManifests.map((manifest) => <PermissionSummary key={manifest.agentId} manifest={manifest} />)}</div> : <div className="resource-contract-empty"><span>◇</span><div><strong>Waiting for registered Agent permissions</strong><p>Permission summaries will appear when the backend supplies real Starter Kit Agent manifests. No access grants or tokens are exposed to the browser.</p></div></div>}
        {session.resourceAccessEvents?.length ? <div className="resource-access-list">{[...session.resourceAccessEvents].reverse().map((event) => <ResourceAccessRow key={event.id} event={event} />)}</div> : <div className="resource-events-empty"><strong>No protected-resource access recorded</strong><p>Allowed and denied gateway decisions will appear here when this workflow requests a protected resource.</p></div>}
      </section>
      <section className="recommendation-section" aria-labelledby="recommendations-title"><header><div><span className="resource-panel-eyebrow">Selective automation</span><h2 id="recommendations-title">Recommendations</h2></div><span>{session.recommendations?.length ?? 0} decisions</span></header>{session.recommendations?.length ? <div className="recommendation-grid">{session.recommendations.map((recommendation) => <RecommendationCard key={recommendation.id} recommendation={recommendation} />)}</div> : <div className="recommendation-empty"><strong>No recommendation-only decisions</strong><p>High-impact or evidence-conflicted proposals will remain visible here without being executed.</p></div>}</section>
      <section className="relay-detail-grid">
        <article className="reference-panel evidence-panel">
          <header><h2>Evidence</h2><span className="soft-badge">{session.evidence?.length ?? evidence.length} records</span></header>
          <div className="evidence-list">{session.evidence?.length ? session.evidence.map((record) => <div className="evidence-row" key={record.id}><span className="evidence-icon">▤</span><div><strong>{record.claim}</strong><small>{record.sourceRefs.join(" · ")}</small></div><div><b>{record.status}</b><small>{record.taskId}</small></div></div>) : evidence.map(([title, source, kind, icon]) => <div className="evidence-row" key={title}><span className="evidence-icon">{icon === "web" ? "◎" : icon === "sheet" ? "▦" : "▤"}</span><div><strong>{title}</strong><small>{source}</small></div><div><b>Preview</b><small>{kind}</small></div></div>)}</div>
          <button className="panel-link">View all evidence →</button>
        </article>
        <article className="reference-panel decision-panel" ref={decisionPanelRef} tabIndex={-1}>
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
