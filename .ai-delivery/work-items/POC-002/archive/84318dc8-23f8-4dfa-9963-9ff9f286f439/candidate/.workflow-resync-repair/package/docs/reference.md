# Command reference

The installed CLI is authoritative:

```powershell
npx.cmd --no-install ai-delivery --help
```

All workflow commands accept `--root PATH`. Commands that confirm an approval, risk reduction, High Risk review, promotion, or completion require an interactive terminal.

## Setup and health

| Command | Purpose |
| --- | --- |
| `init [--dry-run] [--force]` | Detect projects and create content-bound setup changes |
| `upgrade [--dry-run] [--resume]` | Plan or apply supported data migrations |
| `doctor [--json]` | Check host, Docker, OPA, project, toolchain, and provider readiness |
| `credentials status` | Report configured credential providers without revealing secrets |
| `credentials set codex\|claude --stdin` | Store a provider key with Windows DPAPI |
| `policy start\|status\|stop` | Manage the local OPA policy service |
| `toolchain prepare\|verify --project ID` | Build or verify the offline validation image |
| `recover --dry-run\|--apply` | Inspect or finish journaled operations |

Initialization accepts repeatable `--project id:path`, provider/model settings, and digest-pinned `--node-image`, `--bun-image`, or `--dotnet-image` values. Use the help output from the installed build for its exact option set.

## Work items and artifacts

```text
work create --id ID --project PROJECT [--profile PROFILE] [--ticket TEXT] [--path PATH ...]
work status --id ID
work list
work next --id ID
discovery submit --id ID --file FILE
spec submit --id ID --file FILE
spec accept --id ID
architecture submit|approve --id ID [--file FILE]
plan submit|approve --id ID [--file FILE]
implementation begin --id ID
implementation revise --id ID --reason TEXT
complete --id ID
```

`session start` is the normal way to enter implementation because it creates and binds the required governed session. `implementation begin` cannot bypass that requirement.

## Risk, capability, and governance

```text
risk show --id ID
risk assess --id ID [--path PATH ...] [--dependency NAME ...]
  [--network] [--db-migration] [--authorization] [--credential]
risk override --id ID --profile PROFILE [--reason TEXT]
capability show --id ID
governance check-path --project PROJECT --path PATH
```

## Sessions and providers

```text
session start PROVIDER --root PATH --id ID [--prepare-only] [--image IMAGE]
session status|validate|close --session DIRECTORY
session review --session DIRECTORY [--provider PROVIDER] [--prepare-only] [--image IMAGE]
session launch PROVIDER --session DIRECTORY [--prepare-only] [--image IMAGE]
session resume --session DIRECTORY --provider PROVIDER [--prepare-only] [--image IMAGE]
session resync --session DIRECTORY --reason TEXT
session prune --root PATH --dry-run|--apply
context implementation|review --session DIRECTORY
```

`PROVIDER` is one of `codex`, `claude`, `copilot`, or `generic-mcp`. `IMAGE` must be a repository digest or immutable local image ID for isolated-environment work.

## Validation, review, and delivery

```text
command run --session DIRECTORY --command ID
command logs --session DIRECTORY --command ID
validation run --session DIRECTORY
review record --session DIRECTORY --review-session DIRECTORY
promotion preview --session DIRECTORY
promotion apply --session DIRECTORY
evidence verify
```

Callers select configured command IDs; they cannot pass arbitrary arguments or declare their own validation outcome. Review findings and decisions must originate from the independent review session.

## Git and MCP

```text
git root|status|diff|changed|baseline
git history --file FILE [--limit N]
mcp serve --session DIRECTORY
mcp reference-client --session DIRECTORY [--reconnect] [--call TOOL --arguments JSON]
hook pre|post --session DIRECTORY
```

Git commands are inspection-only.

## MCP operations

The server advertises only operations enabled for the current stage and role.

| Area | Operations |
| --- | --- |
| Status and evidence | `status`, `evidence_validate` |
| Files | `file_list`, `file_search`, `file_read`, `file_create`, `file_replace`, `file_delete` |
| Candidate inspection | `git_status`, `git_diff`, `changed_paths`, `scope_validate`, `final_diff_validate` |
| Artifact submission | `discovery_submit`, `specification_submit`, `plan_submit` |
| Implementation | `command_run`, `handoff_submit` |
| Review | `review_submit` |

Tool discovery is informational. Every call repeats schema, session, role, epoch, drift, scope, capability, and OPA checks.

## Repository files

| Path | Meaning |
| --- | --- |
| `.ai-delivery/projects.json` | Project ownership registry |
| `<project>/.ai-delivery/governance.json` | Application policy |
| `.ai-delivery/runtime.json` | Provider and runtime settings |
| `.ai-delivery/work-items/<id>/` | Work-item state and artifacts |
| `.ai-delivery/evidence.jsonl` | Hash-chained evidence |
| external session directory | Candidate, session state, receipts, logs, handoff, review data |
