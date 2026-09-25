# Releasing

Release certification is a separate operation from feature development. Run it from a clean, committed revision on the supported Windows and Docker host.

## Candidate bundle

A candidate bundle is reviewable but does not claim certification:

```powershell
npm.cmd ci
npm.cmd run release:candidate
```

The acceptance report remains incomplete until all final gates are present.

## Deterministic gates

```powershell
npm.cmd run check
npm.cmd run policy:test
```

`check` includes typecheck, lint, the deterministic suite, tarball installation, and clean Git-source installation.

## Docker boundary gate

Commit the intended release content and make sure the tracked worktree is clean:

```powershell
git status --short
npm.cmd run docker:test
```

The receipt must bind the exact `HEAD`, host, Docker Linux engine, runtime images, profiles, and hashed check results. It requires these canonical checks exactly once:

1. `docker-linux-engine`
2. `build-generic`
3. `build-codex`
4. `build-claude`
5. `build-copilot`
6. `restricted-runtime-generic`
7. `restricted-runtime-codex`
8. `restricted-runtime-claude`
9. `restricted-runtime-copilot`
10. `codex-version`
11. `claude-version`
12. `validation-offline`
13. `isolated-review-generic-mcp`
14. `vscode-home-writable`

Additional uniquely named checks are allowed. Missing required IDs and duplicate required or extra IDs invalidate the receipt.

## Live provider acceptance

Run live workflows for `generic-mcp`, `codex`, `claude`, and `copilot` across all three profiles. Each receipt under `acceptance/live/PROVIDER.json` must:

- bind the exact release `HEAD`,
- identify an immutable runtime image,
- contain completion and delivery evidence for Lightweight, Standard, and High Risk,
- hash every required provider boundary check,
- match the provider compatibility manifest.

Copilot acceptance also covers login, hook activation, native tool location, execution location, restart behavior, proxy confinement, and its writable VS Code home volume. Missing credentials or an untested provider is a failed release gate.

## Tag and final bundle

Create an annotated tag only after reviewing the exact committed candidate:

```powershell
git tag -a v1.0.0 -m 'AI Delivery Workflow v1.0.0'
git cat-file -t refs/tags/v1.0.0
git rev-parse 'refs/tags/v1.0.0^{}'
git rev-parse HEAD
```

The object type must be `tag`, and the peeled target must equal `HEAD`. Lightweight tags, absent tags, and tags pointing elsewhere are rejected.

Identify the four certified immutable runtime images and build the final local bundle:

```powershell
$env:AI_DELIVERY_RELEASE_IMAGES = 'generic=IMAGE;codex=IMAGE;claude=IMAGE;copilot=IMAGE'
npm.cmd run release:bundle
```

The final gate reruns deterministic checks and verifies:

- the annotated exact-HEAD tag,
- the exact-HEAD Docker receipt and canonical check set,
- all four live acceptance receipts,
- one image archive per provider matching Docker and live receipts.

The output under `release/v1.0.0/` contains the npm tarball, Git bundle, compatibility manifest, validated receipts, runtime image archives, acceptance report, and `SHA256SUMS`.

Remote creation, publication, pushes, pull requests, and deployment remain outside this package.
