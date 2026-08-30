# AgentRelay threat model

This document distinguishes controls already enforced by AgentRelay from the
planned Resource Gateway work. A UI representation is not treated as a security
control.

## Trust boundaries

The Agent Runtime and model output are untrusted and probabilistic. The Fastify
control plane, policy services, persistence layer, approval service, and
protected executor are trusted and deterministic within this single-user POC.

Two separate boundaries are required:

1. The existing protected external-action boundary controls side effects after
   reasoning.
2. The planned resource-access boundary will control protected reads before and
   during reasoning.

## Controls and proof status

| Threat | Intended control | Current proof |
| --- | --- | --- |
| Agent self-authorizes an external action | Server-owned risk policy and approval | Policy and approval tests |
| Approved payload changes before execution | Canonical payload hash binding | Mutation rejection tests |
| Duplicate external side effect | Executor idempotency key and receipt | Mock executor tests |
| Executor credential reaches the Agent | Server-only executor configuration | Architecture and executor boundary |
| Sensitive value reaches persisted trace | Caller redaction and restricted metadata | Partial; final secret sweep remains |
| Agent reads another Agent's resource | Run-scoped resource scopes | **Planned; not enforced yet** |
| Agent bypasses gateway using filesystem | Protected resources absent from workspaces | **Planned; current fixtures are materialized** |
| Caller forges Agent identity | Server-issued grant bound to Agent/session/task | **Planned** |
| Logical resource path traversal | Normalized exact/prefix resource matching | **Planned** |
| Agent expands its resource scope | Server-owned manifest and immutable grant | **Planned** |

## Browser-data boundary

The browser may receive Agent IDs, capabilities, safe logical resource handles,
allow/deny decisions, and deterministic reason codes. It must never receive:

- access-grant identifiers or tokens;
- authorization headers;
- executor or provider credentials;
- raw host filesystem paths;
- unredacted internal errors.

## POC limitations

- Single-user and single-process JSON persistence.
- No production identity, IAM, tenant isolation, or hardened sandbox.
- Controlled team-authored fixtures only.
- Mock email is the reproducible default; Resend is optional.
- Resource Gateway enforcement and its adversarial tests remain future work.
