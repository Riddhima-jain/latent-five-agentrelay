# Contributing

Keep changes focused, reproducible, and suitable for a three-day student
hackathon.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

For container-based Agent execution, follow
[docs/LOCAL_POC.md](docs/LOCAL_POC.md).

## Validate

```bash
npm run check
terraform fmt -check -recursive deploy/volcengine
docker compose config
```

Before a demo or a security-sensitive workflow change, also run:

```bash
npm run test:coverage
npm run docs:check-links
```

Follow the walkthrough in [docs/DEMO.md](docs/DEMO.md), including the approval,
denial, resource-scope, and evidence-validation paths. Confirm that a
`SEND_EMAIL` action remains pending until its payload-bound approval is granted;
never bypass the coordinator, policy, Resource Gateway, or executor boundary to
make a demo pass.

## Documentation and security

- Keep [docs/DEMO.md](docs/DEMO.md), [docs/threat-model.md](docs/threat-model.md),
  and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) accurate when a workflow,
  policy, approval, protected-resource, or executor boundary changes.
- Use descriptive headings and working relative links. Run `npm run docs:check-links`
  after editing Markdown.
- Do not add secrets, approval tokens, protected-resource contents, or email
  payloads to logs, fixtures, traces, screenshots, or documentation.
- Report vulnerabilities privately under [SECURITY.md](SECURITY.md); do not open
  a public issue with exploit steps or sensitive details.

## Pull requests

- Explain the behavior and reason for the change.
- Add tests for API, lifecycle, persistence, or Runtime changes.
- Update English documentation and `.env.example` when configuration changes.
- Use GitHub Flavored Markdown and relative repository links.
- Never commit credentials, local state, workspaces, build output, or Terraform
  state.
