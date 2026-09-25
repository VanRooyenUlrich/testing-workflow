export const help = `ai-delivery 1.0.0

Usage:
  ai-delivery init [--dry-run] [--force] [--project id:path ...] [--node-image IMAGE] [--bun-image IMAGE] [--dotnet-image IMAGE]
  ai-delivery upgrade [--dry-run] [--resume]
  ai-delivery doctor [--json]
  ai-delivery credentials status
  ai-delivery credentials set codex|claude --stdin
  ai-delivery recover --dry-run|--apply
  ai-delivery toolchain prepare --project ID
  ai-delivery toolchain verify --project ID
  ai-delivery work create --id ID --project PROJECT [--profile PROFILE] [--ticket TEXT] [--path PATH ...]
  ai-delivery work status --id ID
  ai-delivery work list
  ai-delivery work next --id ID
  ai-delivery discovery submit --id ID --file FILE
  ai-delivery spec submit --id ID --file FILE
  ai-delivery spec accept --id ID
  ai-delivery architecture submit|approve --id ID [--file FILE]
  ai-delivery plan submit|approve --id ID [--file FILE]
  ai-delivery risk show --id ID
  ai-delivery risk assess --id ID [--path PATH ...] [--dependency NAME ...] [--network] [--db-migration] [--authorization] [--credential]
  ai-delivery risk override --id ID --profile PROFILE [--reason TEXT]
  ai-delivery implementation begin --id ID
  ai-delivery implementation revise --id ID --reason TEXT
  ai-delivery complete --id ID
  ai-delivery capability show --id ID
  ai-delivery governance check-path --project PROJECT --path PATH
  ai-delivery evidence verify
  ai-delivery git root|status|diff|changed|baseline
  ai-delivery git history --file FILE [--limit N]
  ai-delivery policy start|status|stop
  ai-delivery session start codex|claude|copilot|generic-mcp --root PATH --id ID [--prepare-only] [--image NAME@sha256:DIGEST|sha256:IMAGE_ID]
  ai-delivery session status|validate|close --session DIRECTORY
  ai-delivery session review --session DIRECTORY [--provider PROVIDER] [--prepare-only] [--image NAME@sha256:DIGEST|sha256:IMAGE_ID]
  ai-delivery session launch PROVIDER --session DIRECTORY [--prepare-only] [--image NAME@sha256:DIGEST|sha256:IMAGE_ID]
  ai-delivery session resume --session DIRECTORY --provider PROVIDER [--prepare-only] [--image NAME@sha256:DIGEST|sha256:IMAGE_ID]
  ai-delivery session prune --root PATH --dry-run|--apply
  ai-delivery session resync --session DIRECTORY --reason TEXT
  ai-delivery context implementation|review --session DIRECTORY
  ai-delivery command run --session DIRECTORY --command ID
  ai-delivery command logs --session DIRECTORY --command ID
  ai-delivery validation run --session DIRECTORY
  ai-delivery review record --session DIRECTORY --review-session DIRECTORY
  ai-delivery grant confidential --session DIRECTORY --path PATH --expires ISO_DATE --reason TEXT
  ai-delivery promotion preview --session DIRECTORY
  ai-delivery promotion apply --session DIRECTORY
  ai-delivery mcp serve --session DIRECTORY
  ai-delivery mcp reference-client --session DIRECTORY [--reconnect] [--call TOOL --arguments JSON]
  ai-delivery hook pre|post --session DIRECTORY

All workflow commands accept --root PATH. Human-confirmed actions require an interactive TTY.
Detected commands require a matching digest-pinned base image. toolchain prepare builds lockfile-bound dependency images; validation uses their immutable local IDs offline.
OPA must be available at http://127.0.0.1:8181. The gateway fails closed if it is unavailable.
`;
//# sourceMappingURL=help.js.map