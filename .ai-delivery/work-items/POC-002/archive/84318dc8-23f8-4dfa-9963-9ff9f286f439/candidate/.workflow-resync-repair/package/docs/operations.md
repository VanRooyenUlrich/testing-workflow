# Operations

The controller fails closed when policy, session bindings, evidence, or runtime prerequisites cannot be verified. Use the reported error code and repair the control plane; do not edit receipts to bypass a gate.

## Health checks

```powershell
npx.cmd --no-install ai-delivery doctor --json
npx.cmd --no-install ai-delivery policy status
npx.cmd --no-install ai-delivery toolchain verify --project PROJECT
npx.cmd --no-install ai-delivery evidence verify
```

Use `work status` to inspect the current item and `work next` to recover the intended command after an interruption.

## Common failures

| Error | Meaning | Recovery |
| --- | --- | --- |
| `HANDOFF_REQUIRED` | The candidate has no implementation handoff | Resume the implementation provider and call `handoff_submit` |
| `HANDOFF_STALE` | Handoff content or its candidate/governance/manifest binding changed | Inspect the candidate and submit a new handoff |
| `WORKFLOW_SUSPENDED` | The host changed outside an expected governed operation | Investigate the change, then run interactive `session resync` |
| `SESSION_EXPIRED` | The fixed session lifetime ended | Start a replacement session |
| `SESSION_REVOKED` | A new epoch, replacement review, or explicit close superseded the session | Use the active session reported by the work item |
| `SESSION_STATE_STALE` | Lifecycle state and session role no longer agree | Start or use the replacement session |
| `GOVERNANCE_STALE` / `MANIFEST_STALE` | Bound policy or capabilities changed | Reassess the work and create a fresh session |
| `APPROVAL_REQUIRED_OR_STALE` | An approved artifact or risk input changed | Return to the reported phase and approve the new hash |
| `COMMAND_EVIDENCE_REQUIRED` | A required command lacks a current passing receipt | Run validation again after repairing the command |
| `REVIEW_SESSION_STALE` | Review identity, candidate, handoff, findings, or confirmation hash does not match | Create a fresh review session |
| `WORKSPACE_DRIFT` / `HOST_DRIFT` | Files changed outside the recorded expected snapshot | Investigate and resynchronize or replace the session |

Expired, malformed, revoked, mismatched, and unreadable review sessions are replaceable. `work next` reports a fresh `session review` action without mutating the old session.

## Suspension and resynchronization

```powershell
npx.cmd --no-install ai-delivery session resync `
  --session SESSION_DIRECTORY `
  --reason 'Explained external editor change'
```

Resynchronization is interactive. It closes the old candidate and invalidates its validation and review evidence. Start the new session reported by the work item and repeat implementation handoff, validation, and review.

## Revision after failure

When governed validation fails and needs implementation work:

```powershell
npx.cmd --no-install ai-delivery implementation revise `
  --id WORK-123 `
  --reason 'Fix failed integration check'
```

A recorded `CHANGES_REQUESTED` review performs this revision automatically. Both paths produce a new implementation session and epoch.

## Interrupted operations

Promotion, session binding, review import, and upgrade operations use journals so recovery can determine whether work was staged or completed.

```powershell
npx.cmd --no-install ai-delivery recover --root . --dry-run
npx.cmd --no-install ai-delivery recover --root . --apply
```

Inspect the dry run before applying it. Recovery is for completing known journaled operations, not for accepting unknown workspace drift.

Prune inactive external session directories separately:

```powershell
npx.cmd --no-install ai-delivery session prune --root . --dry-run
npx.cmd --no-install ai-delivery session prune --root . --apply
```

## Logs and evidence

```powershell
npx.cmd --no-install ai-delivery command logs --session SESSION_DIRECTORY --command COMMAND_ID
npx.cmd --no-install ai-delivery evidence verify
```

Command receipts store output and log hashes. Evidence is an ordered JSONL hash chain. It intentionally excludes secrets, prompts, hidden reasoning, source content, and full diffs. Anchor the latest evidence head in an external system if tail-truncation detection is required.

## Upgrades

Preview every migration:

```powershell
npx.cmd --no-install ai-delivery upgrade --root C:\src\consumer --dry-run
npx.cmd --no-install ai-delivery upgrade --root C:\src\consumer
```

Apply requires interactive acceptance of the exact migration-plan hash. If a migration is interrupted, inspect the retained journal and accepted plan before using `--resume`.

Supported migrations preserve unrelated configuration and historical completed work. Unfinished older work receives a new gate version, stale evidence, and a fresh session epoch. Forward package, governance, or schema versions fail closed.

## Windows and Docker notes

- Use `npm.cmd` and `npx.cmd` if PowerShell blocks unsigned script shims.
- Docker Desktop must use Linux containers.
- The path layer rejects traversal, drive escapes, alternate data streams, device names, symlinks, junctions, reparse aliases, and hard-link escapes.
- High Risk execution never falls back to unrestricted host execution.
- A changed lockfile or SDK declaration requires `toolchain prepare` and `toolchain verify` again.
