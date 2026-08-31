import { useEffect, useState } from "react";
import { api } from "./api";
import type { PolicySimulationResult, RelayAgentManifestView } from "./types";

const examples = ["market/report.json", "finance/revenue.csv", "customer/customer-list.json"] as const;

export default function PolicySimulator({ manifests, initialAgentId }: { manifests: RelayAgentManifestView[]; initialAgentId?: string }) {
  const [agentId, setAgentId] = useState(initialAgentId && manifests.some((agent) => agent.agentId === initialAgentId) ? initialAgentId : manifests[0]?.agentId ?? "");
  const [resource, setResource] = useState("finance/revenue.csv");
  const [result, setResult] = useState<PolicySimulationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialAgentId && manifests.some((agent) => agent.agentId === initialAgentId)) setAgentId(initialAgentId);
  }, [initialAgentId, manifests]);

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      setResult((await api.simulatePolicy({ agentId, tool: "resource.read", resource: resource.trim(), operation: "read" })).result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return <section className="policy-simulator" aria-labelledby="policy-simulator-title"><header><div><span className="eyebrow">Read-only policy workbench</span><h2 id="policy-simulator-title">Test permissions</h2><p>Probe the real server-side tool policy without starting a workflow or reading protected data.</p></div><span className="policy-dry-run">Dry run</span></header><form onSubmit={run}><label>Agent<select value={agentId} onChange={(event) => { setAgentId(event.target.value); setResult(null); }}>{manifests.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select></label><label>Tool<input value="resource.read" readOnly /></label><label className="policy-resource-field">Resource<input value={resource} maxLength={240} onChange={(event) => { setResource(event.target.value); setResult(null); }} placeholder="finance/revenue.csv" required /></label><label>Operation<input value="read" readOnly /></label><button className="button button-primary" disabled={busy || !agentId || !resource.trim()}>{busy ? "Evaluating…" : "Evaluate policy →"}</button></form><div className="policy-examples"><span>Try a resource</span>{examples.map((example) => <button type="button" key={example} onClick={() => { setResource(example); setResult(null); }}>{example}</button>)}</div>{error && <div className="policy-simulator-error" role="alert">{error}</div>}{result && <article className={`policy-simulation-result policy-result-${result.decision.toLowerCase()}`} aria-live="polite"><span className="policy-result-icon">{result.decision === "ALLOW" ? "✓" : "×"}</span><div><header><strong>{result.decision === "ALLOW" ? "Access allowed" : "Access denied"}</strong><code>{result.reason.replaceAll("_", " ")}</code></header><p><b>{result.agentName}</b> requested <code>{result.resource}</code>.</p><dl><div><dt>Allowed tool</dt><dd>{result.allowedTools.join(", ") || "None"}</dd></div><div><dt>Permitted scope</dt><dd>{result.resourceScopes.join(", ") || "No protected resources"}</dd></div><div><dt>Side effects</dt><dd>None — policy evaluation only</dd></div></dl></div></article>}</section>;
}
