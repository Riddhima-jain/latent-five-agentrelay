# AgentRelay demo SOP

This SOP exercises real Codex workflow execution and the real middleware path.
Use only the controlled fixtures committed under `fixtures/sales-recovery/`.

## Setup

1. Configure Ark or Gemini as documented in the [README](../README.md).
2. Keep `EMAIL_EXECUTOR=mock` for the reproducible judging path.
3. Start the platform with `npm run poc` and open <http://localhost:3000>.
4. Open **AgentRelay** in the sidebar.

## Positive path

1. Enter a business goal on the **Start a new workflow** screen. Suggested
   prompts fill the textarea but never start execution automatically.
2. Leave **Demo scenario** set to **Normal workflow**, then choose
   **Start AgentRelay Workflow**.
3. Show Research and Finance running independently, followed by Strategy and Outreach.
4. Open the evidence and trace panels to show real accepted Agent output.
5. At `REQUIRE_APPROVAL`, explain that the browser submits only the decision.
6. Approve the action.
7. Show the payload hash, `action.execution_started`, `action.executed`, and the
   persisted mock receipt.
8. Return to **All workflows** and reopen the session to prove persistence.

## Denial path

1. Expand **Demo scenario**, select **Policy denial**, and start a workflow.
2. The real Agents still run, but the controlled outreach result proposes a
   prohibited action.
3. Show `policy.denied`, the degraded session, no approval control, and no receipt.

## Retry and failure path

1. Expand **Demo scenario**, select **Timeout and retry**, and start a workflow.
2. Show `retry.scheduled` events produced by the coordinator lifecycle.
3. Show the Research task fail after its configured attempts and downstream
   tasks remain blocked.

## Payload-tampering evidence

Automated tests prove that changing the action payload after approval request
invalidates execution and that repeated idempotency keys return one receipt:

```bash
npm run test -w @launchpad/server -- --run \
  src/application/email-executor.test.ts \
  src/application/relay-workflow-service.test.ts
```

## Optional Resend path

Use only a verified sender and team-owned test inbox:

```dotenv
EMAIL_EXECUTOR=resend
RESEND_API_KEY=re_your_scoped_key
RESEND_FROM=AgentRelay <verified-sender@example.com>
RESEND_TO_OVERRIDE=team-owned-test-inbox@example.com
```

Restart the server, run the positive path, and verify that the receipt reports
`resend`. Never put the API key in source, screenshots, traces, or browser data.
