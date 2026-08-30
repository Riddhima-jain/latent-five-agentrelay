# AgentRelay threat model

This document records controls enforced by AgentRelay. A UI representation is
not treated as a security control.

## Trust boundaries

The Agent Runtime and model output are untrusted and probabilistic. The Fastify
control plane, policy services, persistence layer, approval service, and
protected executor are trusted and deterministic within this single-user POC.

Two separate boundaries are required:

1. The existing protected external-action boundary controls side effects after
   reasoning.
2. The resource-access boundary controls protected reads before and
   during reasoning.

## Controls and proof status

| Threat | Intended control | Current proof |
| --- | --- | --- |
| Agent self-authorizes an external action | Server-owned risk policy and approval | Policy and approval tests |
| Approved payload changes before execution | Canonical payload hash binding | Mutation rejection tests |
| Duplicate external side effect | Executor idempotency key and receipt | Mock executor tests |
| Executor credential reaches the Agent | Server-only executor configuration | Architecture and executor boundary |
| Sensitive value reaches persisted trace | Caller redaction and restricted metadata | Partial; final secret sweep remains |
| Agent reads another Agent's resource | Run-scoped resource scopes | Research/Finance gateway tests |
| Agent bypasses gateway using filesystem | Protected resources absent from workspaces and masked in Runtime containers | Container invocation and fixture layout tests |
| Caller forges Agent identity | Server-issued grant bound to Agent/session/task | Gateway ignores caller identity |
| Logical resource path traversal | Normalized exact/prefix resource matching | Traversal table tests |
| Agent expands its resource scope | Server-owned manifest and immutable grant | Grant/policy tests |

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
- Resource scopes use only simple exact and prefix matching; this is not production IAM.
- Host `local-process` development is not a hardened read-isolation boundary; use the default container POC path for the filesystem-bypass demonstration.
