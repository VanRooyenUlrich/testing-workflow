# POC-001 Implementation Plan

## Preconditions

1. Commit the separately authorized .NET governance/bootstrap update before starting the implementation session:
   - `.ai-delivery/governance.json`
   - `ai-delivery-toolchain.csproj`
   - `ai-delivery-validation.targets`
2. Keep the generated `.ai-delivery/toolchains/app.json` receipt local and verify it with `ai-delivery toolchain verify --project app`.
3. Require `ai-delivery doctor --json` to report `ready: true` and keep policy enforcement running.
4. Do not modify governance, bootstrap, provider, evidence, or workflow-state files from the POC-001 implementation session.

## Implementation sequence

### 1. Establish solution-wide configuration

- Add `global.json` for SDK `10.0.300` with roll-forward to compatible installed feature bands.
- Add `Directory.Build.props` with `net10.0`, nullable reference types, implicit usings, and deterministic builds where those settings can be shared safely.
- Add `IssueTracker.sln` containing the API, Core, Infrastructure, and API test projects.
- Use stable project GUIDs and solution configuration mappings so the solution works consistently across supported tooling.

### 2. Add the project structure and dependency direction

- Create `IssueTracker.Core` as a dependency-free class library and add a small `AddCore` service-registration extension point without placeholder business services.
- Create `IssueTracker.Infrastructure` as a class library referencing Core and add an `AddInfrastructure` extension point without database or repository code.
- Create `IssueTracker.Api` as an ASP.NET Core Web project referencing Core and Infrastructure.
- Create `IssueTracker.Api.Tests` referencing the API project.
- Use the exact offline-cached package versions established by repository setup:
  - `Swashbuckle.AspNetCore` 10.2.3 for OpenAPI generation and Swagger UI.
  - `Microsoft.AspNetCore.Mvc.Testing` 10.0.12 for in-memory API hosting.
  - `Microsoft.NET.Test.Sdk` 18.10.1, `xunit` 2.9.3, and `xunit.runner.visualstudio` 4.0.0 for tests.

### 3. Configure the API composition root

- Register Core and Infrastructure through their service-registration extension methods.
- Register ASP.NET Core health checks and map `GET /health`.
- Register Problem Details and centralized exception handling.
- Register endpoint discovery and Swagger generation.
- In Development only, expose the OpenAPI document at `/openapi/v1.json` and Swagger UI at `/swagger`.
- Register a named frontend CORS policy sourced from configuration, with `http://localhost:5173` in development settings, and apply it before endpoint execution.
- Expose the minimal `Program` type required by `WebApplicationFactory` without widening the public API unnecessarily.

### 4. Add automated verification

- Add an xUnit integration test using `WebApplicationFactory<Program>`.
- Start the application in memory, request `/health`, and assert HTTP 200.
- Keep the test independent of ports, external services, databases, authentication, and network access.

### 5. Add repository support and operator documentation

- Extend `.gitignore` for .NET build/test output and common local IDE state while preserving existing workflow ignores.
- Add `.editorconfig` with consistent UTF-8, newline, indentation, and baseline C# conventions.
- Replace the fixture README content with Issue Tracker backend prerequisites and exact restore, build, run, health, Swagger/OpenAPI, and test commands; retain any workflow-specific guidance that remains relevant.

### 6. Governed handoff and validation

- Validate candidate scope before handoff and confirm no database, authentication, issue CRUD, Docker, deployment, or workflow-governance changes entered the candidate.
- Submit a handoff bound to the final candidate snapshot.
- Run every fixed required validation command in the prepared offline images:
  - `dotnet:restore`
  - `dotnet:build`
  - `dotnet:test`
  - `lint`
  - `test`
- If any command fails, revise in a new implementation epoch as required, resubmit the handoff, and rerun all stale checks.
- Start a separate read-only review session, record an independent approval, preview promotion, obtain human confirmation of the exact promotion hash, apply it, complete POC-001, and verify the evidence chain.

## Verification mapping

| Acceptance criterion | Evidence |
| --- | --- |
| Solution restores | Passing `dotnet:restore` receipt |
| Solution builds | Passing `dotnet:build` receipt |
| Automated tests pass | Passing `dotnet:test` receipt showing the health integration test |
| API starts locally | Successful in-memory startup test plus documented local run command |
| `GET /health` returns 200 | Health integration-test assertion |
| OpenAPI and Swagger are Development-only | Code review of environment-gated middleware and independent review |
| Scope exclusions are respected | Governed changed-path/final-diff validation and independent review |

## Expected affected files

- `IssueTracker.sln`
- `global.json`
- `Directory.Build.props`
- `.gitignore`
- `.editorconfig`
- `README.md`
- `src/IssueTracker.Api/**`
- `src/IssueTracker.Core/**`
- `src/IssueTracker.Infrastructure/**`
- `tests/IssueTracker.Api.Tests/**`

No other application paths are expected to change.
