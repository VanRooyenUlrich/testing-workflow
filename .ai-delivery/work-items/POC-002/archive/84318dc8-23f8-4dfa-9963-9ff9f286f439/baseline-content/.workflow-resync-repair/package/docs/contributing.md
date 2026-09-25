# Contributing

Develop against Node.js 22 on Windows with Docker Desktop's Linux engine. Keep changes local until the full deterministic suite passes, and do not regenerate release evidence while the worktree is dirty.

## Set up

```powershell
git clone REPOSITORY_URL
Set-Location ai-delivery-workflow
npm.cmd ci
npm.cmd run build
npm.cmd test
```

The package is private and is designed for immutable Git or local tarball installation.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/cli` | Argument parsing, help, command dispatch, remediation |
| `src/work-items` | Lifecycle orchestration and persistence |
| `src/enforcement` | Sessions, bindings, policy gateway, files, containers, reviews, promotion |
| `src/providers` | Provider configuration, credentials, broker, proxy |
| `src/config` | Initialization, runtime, doctor, toolchains, upgrades |
| `src/validation` | Shared validation and release requirements |
| `schemas` | Persisted JSON contracts |
| `policy` | OPA policy |
| `containers` | Runtime image definitions |
| `test` | Deterministic Node test suite |
| `scripts` | Packaging, policy, Docker, and release gates |

## Design constraints

- Keep the lifecycle states and transition rules centralized.
- Enforce permissions on the server side; provider configuration and MCP descriptions are not security boundaries.
- Keep candidate, handoff, validation, and review hashes derived from one canonical representation.
- Keep Git mutation and publication outside the package.
- Preserve historical records when schemas evolve. Add optional persisted fields when older records must remain readable, then require them in new operations.
- Keep runtime and release semantics in shared source modules when both scripts and application code consume them.
- Prefer focused modules over provider or profile forks of the workflow.
- Keep secrets, prompts, model output, source content, and full diffs out of evidence events.

## Change process

1. Identify the lifecycle state, trust boundary, and persisted records affected.
2. Update TypeScript types and JSON schemas together.
3. Add tests at the lowest meaningful boundary. Include a regression test for security and persistence defects.
4. Run focused tests during development.
5. Run the full deterministic, policy, and package-installation gates.
6. Run the Docker suite only from a clean committed revision when Docker-facing behavior or release evidence is involved.
7. Update the maintained documentation page that owns the behavior; avoid adding another overlapping guide.

## Validation commands

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run policy:test
npm.cmd run package:test
```

`npm run check` runs typecheck, lint, deterministic tests, and package tests. The real boundary suite is separate:

```powershell
npm.cmd run docker:test
```

The Docker suite expects a clean committed tree because its receipt binds the exact Git revision.

## Tests

Tests use Node's built-in test runner and isolated temporary repositories. Prefer observable behavior:

- lifecycle transitions and invalidation,
- schema rejection and backward compatibility,
- session identity, epoch, role, and expiry,
- candidate and receipt hash binding,
- read-only routing behavior,
- container arguments and isolation,
- package behavior after tarball and Git-source installation.

Avoid tests that simply duplicate implementation expressions. For new receipts, test valid input, missing required data, duplicates, tampering, and forward-compatible additions where supported.

## Documentation

The maintained set is:

- `README.md` for purpose and entry points,
- `docs/onboarding.md` for first installation,
- `docs/usage.md` for the end-to-end workflow,
- `docs/lifecycle.md` for canonical phases and gates,
- `docs/architecture.md` for structure and trust boundaries,
- `docs/reference.md` for commands and files,
- `docs/operations.md` for recovery and upgrades,
- `docs/releasing.md` for certification.

Use plain examples with placeholders. Do not publish dated test counts, machine-specific readiness reports, or commands for tags and remotes that do not exist.
