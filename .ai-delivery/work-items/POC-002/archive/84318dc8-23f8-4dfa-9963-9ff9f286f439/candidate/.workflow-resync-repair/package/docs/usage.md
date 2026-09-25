# Usage

This guide runs one work item through the complete governed lifecycle. Complete [onboarding](onboarding.md) first, keep OPA running, and use `work next` after every phase.

Examples use PowerShell and a Standard profile. Replace paths, provider, and image values for your repository.

## Create the work item

```powershell
npx.cmd --no-install ai-delivery work create `
  --id WORK-123 `
  --project app `
  --profile STANDARD `
  --ticket 'Add retry handling' `
  --path 'src/**' `
  --path 'test/**'

npx.cmd --no-install ai-delivery work next --id WORK-123
```

`STANDARD` is the default. Choose `LIGHTWEIGHT` only for constrained, low-risk changes. Use `HIGH_RISK` for credentials, authorization, restricted data, database migrations, governance/security changes, or other architecture-sensitive work.

## Discovery, specification, and plan

Submit artifacts from files:

```powershell
npx.cmd --no-install ai-delivery discovery submit --id WORK-123 --file discovery.md
npx.cmd --no-install ai-delivery spec submit --id WORK-123 --file specification.md
npx.cmd --no-install ai-delivery spec accept --id WORK-123
npx.cmd --no-install ai-delivery plan submit --id WORK-123 --file plan.md
npx.cmd --no-install ai-delivery plan approve --id WORK-123
```

High Risk work also requires:

```powershell
npx.cmd --no-install ai-delivery architecture submit --id WORK-123 --file architecture-impact.md
npx.cmd --no-install ai-delivery architecture approve --id WORK-123
```

Human-confirmed commands show the exact artifact hash and require `CONFIRM` on an interactive terminal.

An attached provider can submit discovery, specification, and plan artifacts through the stage-specific MCP tools. Acceptance and approval remain CLI-operated human actions.

## Start implementation

```powershell
$session = npx.cmd --no-install ai-delivery session start codex --root . --id WORK-123
```

The command creates the governed session, advances the item into implementation, prepares the selected provider, and launches it unless `--prepare-only` is supplied. Capture the session directory from the JSON output.

Supported providers are `codex`, `claude`, `copilot`, and `generic-mcp`. For High Risk, supply the approved runtime image:

```powershell
npx.cmd --no-install ai-delivery session start codex --root . --id WORK-123 --image 'registry.example/ai-runtime@sha256:<digest>'
```

Preparation and execution can be separated:

```powershell
npx.cmd --no-install ai-delivery session start codex --root . --id WORK-123 --prepare-only
npx.cmd --no-install ai-delivery session launch codex --session SESSION_DIRECTORY
npx.cmd --no-install ai-delivery session resume --session SESSION_DIRECTORY --provider codex
```

The preparation receipt is valid only when its provider, session, epoch, role, runtime settings, governance, manifest, entrypoint, and managed file hashes still match.

## Submit the implementation handoff

When implementation is complete, the provider calls:

```text
handoff_submit {
  "content": "Summary of changes, key decisions, validation guidance, and remaining concerns."
}
```

The handoff is mandatory for every profile. It is stored in the control directory and bound to the current candidate snapshot. Any later file mutation invalidates it, so the provider must submit a new handoff after the final change.

If `work next` reports a missing or stale handoff, resume the implementation provider against the same session. A current handoff makes the next action `validation run`.

## Validate

```powershell
npx.cmd --no-install ai-delivery validation run --session SESSION_DIRECTORY
```

`session validate` is an alias. Validation:

1. verifies the handoff and candidate bindings,
2. runs every required governance command in its prepared offline image,
3. checks scope and the final diff,
4. records execution-backed validation evidence,
5. changes the session role from implementation to validation.

Call `work next --id WORK-123` again. If validation is incomplete it recommends validation; otherwise it routes into review.

## Review

Create the independent review session:

```powershell
npx.cmd --no-install ai-delivery session review --session SESSION_DIRECTORY --provider claude
```

For an isolated environment, add `--image IMAGE`. The review session receives a read-only candidate, approved artifacts, validation context, and the verified implementation handoff.

The review provider calls:

```text
review_submit {
  "content": "Findings and rationale.",
  "outcome": "APPROVED"
}
```

Allowed outcomes are `APPROVED` and `CHANGES_REQUESTED`. Record the submitted decision:

```powershell
npx.cmd --no-install ai-delivery review record `
  --session SESSION_DIRECTORY `
  --review-session REVIEW_DIRECTORY
```

High Risk review recording requires interactive acceptance of the exact confirmation hash.

If review requests changes, the controller returns the work item to `IMPLEMENTING`, creates a new implementation session and epoch, and stales prior validation and review evidence. Use the new `enforcementSession` returned by the command.

## Promote and complete

Standard and High Risk candidates are delivered to the host checkout through previewed, human-confirmed promotion:

```powershell
npx.cmd --no-install ai-delivery promotion preview --session SESSION_DIRECTORY
npx.cmd --no-install ai-delivery promotion apply --session SESSION_DIRECTORY
```

Lightweight work skips promotion because implementation already occurred in the governed host workspace. Completion verifies that it still matches the reviewed snapshot.

```powershell
npx.cmd --no-install ai-delivery complete --id WORK-123
npx.cmd --no-install ai-delivery evidence verify
```

Completion requires an approved current review, current validation and handoff bindings, delivery where applicable, and interactive human confirmation. The controller archives the handoff and review artifacts with the completed work item.

## Inspect and reassess

```powershell
npx.cmd --no-install ai-delivery work status --id WORK-123
npx.cmd --no-install ai-delivery capability show --id WORK-123
npx.cmd --no-install ai-delivery risk show --id WORK-123
npx.cmd --no-install ai-delivery governance check-path --project app --path src/retry.ts
npx.cmd --no-install ai-delivery command logs --session SESSION_DIRECTORY --command test
```

When scope or intent changes, update the risk assessment:

```powershell
npx.cmd --no-install ai-delivery risk assess --id WORK-123 --path 'src/security/**' --authorization
```

Use `--network`, `--db-migration`, `--credential`, and `--dependency NAME` only when they describe the work. Risk reduction requires a reason and interactive confirmation, and non-downgradable triggers cannot be overridden.

## Use `work next`

`work next` is the safest entry point after an interruption. During validation it routes in this order:

1. run missing validation,
2. create a review session when none is usable,
3. resume an active review without a submission,
4. record a submitted review decision.

Expired, revoked, malformed, mismatched, or unreadable review sessions are replaceable. Calculating the next action never revokes or replaces them. Provider names are inferred only from a valid session-bound preparation receipt; otherwise the command uses the `PROVIDER` placeholder.

See [operations](operations.md) for suspension, recovery, expired sessions, upgrades, and troubleshooting.
