# Onboarding

Onboarding installs the controller in a consumer repository, defines project ownership, prepares offline validation images, and verifies local prerequisites.

## Prerequisites

- Windows 11 x64
- Node.js 22 or newer
- Git
- Docker Desktop running Linux containers
- A clean or deliberately preserved consumer worktree
- Digest-pinned Linux base images for each detected Node, Bun, or .NET toolchain

Check the host:

```powershell
node --version
npm.cmd --version
git --version
docker info --format '{{.OSType}}/{{.Architecture}}'
```

The Docker result must start with `linux/`.

## Install

For local evaluation, create and install a tarball from a reviewed source checkout:

```powershell
# In this package repository
npm.cmd ci
npm.cmd pack

# In the consumer repository
npm.cmd install --save-dev 'C:\releases\ai-delivery-workflow-1.0.0.tgz'
npx.cmd --no-install ai-delivery --help
```

Use an immutable Git tag only after that tag exists and has completed the release process:

```powershell
npm.cmd install --save-dev 'git+https://HOST/OWNER/ai-delivery-workflow.git#v1.0.0'
```

Tarball creation builds through `prepack`; Git installation builds through `prepare`. `npm run package:test` verifies both installation paths.

## Choose project boundaries

A repository can contain:

- one root project such as `app:.`, or
- multiple non-overlapping sibling projects such as `web:apps/web` and `api:apps/api`.

Root and child ownership cannot coexist because their paths overlap. Nested projects are also rejected. A registered child project must contain the lockfiles and build context needed by its validation commands; registration does not automatically include sibling or parent workspace dependencies.

## Preview initialization

```powershell
npx.cmd --no-install ai-delivery init `
  --dry-run `
  --project app:. `
  --provider generic-mcp `
  --node-image 'node@sha256:<digest>'
```

Review the proposed paths, hashes, merges, and patches. Initialization:

- writes `.ai-delivery/projects.json`,
- writes application-local governance,
- installs the workflow skill and provider configuration,
- adds only managed MCP/hook settings,
- preserves unrelated configuration,
- leaves malformed or conflicting files for manual resolution.

Apply after reviewing the plan:

```powershell
npx.cmd --no-install ai-delivery init `
  --project app:. `
  --provider generic-mcp `
  --node-image 'node@sha256:<digest>'
```

`--force` is reserved for an exact reviewed plan hash and interactive confirmation. It does not make malformed or ambiguous configuration safe to overwrite.

## Configure a provider

| Provider | Setup |
| --- | --- |
| `generic-mcp` | Configure the generated repository-local MCP command in a client whose native tools you have assessed |
| `codex` | Set a model during initialization and store a dedicated API key with `credentials set codex --stdin` |
| `claude` | Set a model during initialization and store a dedicated API key with `credentials set claude --stdin` |
| `copilot` | Use the supported VS Code/Copilot login in its isolated profile |

Store Codex or Claude credentials without placing them in shell history:

```powershell
$env:OPENAI_API_KEY | npx.cmd --no-install ai-delivery credentials set codex --stdin
Remove-Item Env:OPENAI_API_KEY
npx.cmd --no-install ai-delivery credentials status
```

The credential store uses Windows DPAPI. Provider processes receive short-lived broker tokens rather than the saved upstream secret.

## Start policy and prepare toolchains

```powershell
npx.cmd --no-install ai-delivery policy start
npx.cmd --no-install ai-delivery policy status
npx.cmd --no-install ai-delivery toolchain prepare --project app
npx.cmd --no-install ai-delivery toolchain verify --project app
```

Preparation may use network access to resolve dependencies. It records lockfile and declaration hashes, creates an immutable local image, and proves configured commands offline. Normal validation then runs with `--network=none`.

Re-run preparation when package locks, SDK declarations, configured commands, or base images change.

## Verify readiness

```powershell
npx.cmd --no-install ai-delivery doctor --json
```

Resolve every failed requirement for the selected provider and project. A generic MCP transport warning is explicit because the controller cannot prove restrictions imposed by an arbitrary external client.

Create a small trial item and follow [usage](usage.md). Use `LIGHTWEIGHT` only when the change actually satisfies the repository's risk rules; onboarding is not a reason to lower risk.
