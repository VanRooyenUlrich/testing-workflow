# AI Delivery Workflow

AI Delivery Workflow is a repository-local controller for governed AI-assisted software delivery. It gives Codex, Claude Code, VS Code/Copilot, and generic MCP clients one lifecycle, one evidence model, and risk-based isolation.

The package is currently a release candidate. Deterministic, policy, and package-installation tests pass; final certification still requires a clean committed revision, the real Docker boundary suite, live provider acceptance, and an annotated release tag.

## What it controls

- A fixed lifecycle from discovery through completion.
- Application-owned path, command, risk, and validation policy.
- Stage-specific MCP tools backed by server-side authorization.
- Candidate isolation for Standard and High Risk work.
- Candidate-bound implementation handoffs, validation receipts, and independent reviews.
- Hash-chained evidence and explicit human confirmation at required gates.

It does not create commits, push branches, open pull requests, deploy applications, or update external ticket systems.

## Requirements

- Windows 11 x64
- Node.js 22 or newer
- Git
- Docker Desktop using Linux containers
- OPA, started through the bundled policy command

## Quick start

Build a local package from this checkout:

```powershell
npm.cmd ci
npm.cmd pack
```

Install that tarball in a consumer repository, then initialize one governed project:

```powershell
npm.cmd install --save-dev 'C:\releases\ai-delivery-workflow-1.0.0.tgz'
npx.cmd --no-install ai-delivery init --project app:. --provider generic-mcp --node-image 'node@sha256:<digest>'
npx.cmd --no-install ai-delivery policy start
npx.cmd --no-install ai-delivery toolchain prepare --project app
npx.cmd --no-install ai-delivery doctor --json
```

Create work and follow the controller:

```powershell
npx.cmd --no-install ai-delivery work create --id WORK-123 --project app --profile STANDARD --path 'src/**'
npx.cmd --no-install ai-delivery work next --id WORK-123
```

`work next` is read-only. Run it after each phase and execute the command it returns. During implementation the agent must submit a candidate-bound handoff through the `handoff_submit` MCP tool before validation can begin.

## Documentation

- [Onboarding](docs/onboarding.md)  install and configure a consumer repository.
- [Usage](docs/usage.md)  run a work item from discovery through completion.
- [Lifecycle](docs/lifecycle.md)  states, profiles, gates, and revision behavior.
- [Architecture](docs/architecture.md)  components, trust boundaries, and persisted data.
- [Command reference](docs/reference.md)  CLI and MCP surfaces.
- [Operations](docs/operations.md)  recovery, troubleshooting, and upgrades.
- [Contributing](docs/contributing.md)  develop and test this package.
- [Releasing](docs/releasing.md)  produce and certify a local release.

Run `npx.cmd --no-install ai-delivery --help` for the exact command syntax supported by the installed version.
