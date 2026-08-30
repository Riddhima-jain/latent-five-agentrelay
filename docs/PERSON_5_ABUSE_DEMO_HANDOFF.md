# Person 5 abuse-demo handoff

## Resource-scope abuse backend now available

Create a workflow with:

```json
{
  "goal": "Investigate the sales decline and prepare safe recovery actions.",
  "scenario": "resource_abuse"
}
```

During the Research task, AgentRelay now uses Research's still-active run grant
to request `finance/finance-report.csv`. The existing Resource Gateway denies
the request with `RESOURCE_OUT_OF_SCOPE`, persists the real
`tool.access.denied` event, and the workflow continues normally. The resulting
session projection includes this sequence in `resourceAccessEvents`:

```text
Research -> market/market-report.json  -> ALLOW
Research -> finance/finance-report.csv -> DENY
Finance  -> finance/finance-report.csv -> ALLOW
```

No access-grant identifier is returned to the browser.

## Frontend additions required

Person 5 should make only these UI/client changes:

1. Add `"resource_abuse"` to the `scenario` request union in
   `apps/web/src/api.ts`.
2. Add `"resource_abuse"` to the dashboard scenario state union in
   `apps/web/src/AgentRelayDashboard.tsx`.
3. Add a selector option labelled **Resource-scope attack**. Describe it as a
   controlled security probe, not a model-generated attack.
4. When a `resourceAccessEvents` item has `decision: "DENY"`, show a compact
   **Attack contained** banner with Agent, resource, and reason. Reuse the
   existing resource-access row for the detailed ALLOW/DENY/ALLOW sequence.
5. Remove the hard-coded preview evidence shown while a workflow has zero real
   evidence; render an honest waiting state instead.
6. Correct the approval requester label from Strategy Agent to Outreach Agent.
7. In the trace, expose safe `actionType`, decision, and reason metadata so the
   controlled policy events are intelligible to judges.

## Protected-action abuse still owned by Persons 4/5

The current protected mock service is in-process, so the Agent Runtime cannot
make a real request and receive a visible 403. Do not claim that live behavior
until the following is implemented by the owning Persons:

1. P4: expose a local protected-email HTTP facade guarded by a distinct
   executor-only credential and backed by the existing mock protected service.
2. P4: preferably route the trusted executor through the same facade with its
   credential, preserving approval verification and idempotency.
3. P5: add an **Attempt direct send as Agent Runtime** control at
   `awaiting_approval` that launches a credential-free Runtime probe.
4. P5: project and display the safe result: origin, target, HTTP 403, denial
   reason, and side-effect count remaining zero. Never expose either credential.
5. P5: after normal approval, show the contrasting trusted path and exactly one
   receipt/side effect.

If the service remains in-process, present the existing bypass tests as proof
of an unreachable capability instead of showing a fictional HTTP 403.
