# Security policy

Volc Agent Launchpad is a hackathon proof of concept. Only the latest revision
on the default branch is supported.

## Report a vulnerability

Send the repository owner or event organizer the affected revision,
reproduction steps, impact, and suggested mitigation. Do not publish
credentials, personal data, or exploit details in an issue.

## Known limitations

- Shared demo token; no user identity, authorization, RBAC, or tenant isolation
- No CSRF protection
- No per-Agent container boundary in ECS mode
- Ordinary local containers, not hardened multi-tenant sandboxes
- Broad outbound network access
- Prompt-triggered command and file execution
- Ark key available to the server and active Runtime container
- Ark key stored in Terraform POC state
- Relay JSON persistence is single-process and has no backup or multi-node coordination
- Optional Resend delivery depends on an external provider and a verified sender
- Resource scopes use a simple logical exact/prefix policy and are not production IAM

## Safe use

- Use a dedicated development machine or disposable ECS instance.
- Use a scoped, revocable Ark key and a unique `APP_AUTH_TOKEN`.
- Keep local use on loopback and restrict ECS Web and SSH CIDRs.
- Add HTTPS before sending the shared token over an untrusted network.
- Never mount production data or provide Volcengine account AK/SK to Agents.
- Keep `EMAIL_EXECUTOR=mock` for judging. When testing Resend, use a scoped key
  and a team-owned `RESEND_TO_OVERRIDE`; never use a customer address.
- Stop the POC, destroy test resources, and revoke keys after the event.

Codex uses `workspace-write` when Landlock is available. On unsupported kernels,
startup warns and relies on the outer Docker or rootless Podman boundary. This
fallback is not tenant isolation.
