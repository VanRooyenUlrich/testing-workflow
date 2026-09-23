# POC-001 Specification

## Objective

Create the initial .NET backend foundation for the Issue Tracker proof of concept. Deliver a buildable four-project solution, a runnable ASP.NET Core API, baseline development middleware, and an automated health-endpoint test. Do not implement issue-management features or persistence.

## Platform and solution structure

1. The solution must target .NET 10 and pin SDK `10.0.300` through `global.json` with a suitable roll-forward policy for compatible patch updates.
2. The root solution file must be `IssueTracker.sln`.
3. The solution must contain these projects:
   - `src/IssueTracker.Api/IssueTracker.Api.csproj` using the ASP.NET Core Web SDK.
   - `src/IssueTracker.Core/IssueTracker.Core.csproj` as the domain/core class library.
   - `src/IssueTracker.Infrastructure/IssueTracker.Infrastructure.csproj` as the infrastructure class library.
   - `tests/IssueTracker.Api.Tests/IssueTracker.Api.Tests.csproj` as the automated test project.
4. Project references must enforce this dependency direction:
   - API references Core and Infrastructure.
   - Infrastructure references Core.
   - API tests reference API.
   - Core does not reference API or Infrastructure.
5. API and Infrastructure may expose dependency-injection registration extension methods as composition points. The ticket must not add placeholder repositories, database services, issue services, or other out-of-scope behavior merely to populate those methods.

## API behavior

1. `GET /health` must be anonymously callable and return HTTP 200 while the new application is healthy.
2. The health endpoint may use ASP.NET Core's built-in health-check services and response format; this ticket does not require dependency-specific health probes.
3. The application must register Problem Details and centralized exception handling. An unhandled request-processing exception must be eligible for an `application/problem+json` RFC 7807-compatible response without exposing development exception details outside Development.
4. A named CORS policy must read allowed frontend origins from configuration. Development configuration must allow `http://localhost:5173` unless this assumption is corrected before specification acceptance. The policy must not allow arbitrary origins together with credentials.
5. In the `Development` environment:
   - An OpenAPI JSON document must be available at `/openapi/v1.json`.
   - Swagger UI must be available at `/swagger` (including the conventional trailing-slash form).
6. OpenAPI JSON generation and Swagger UI must not be enabled outside the `Development` environment.
7. The API must start with `dotnet run --project src/IssueTracker.Api/IssueTracker.Api.csproj` after restore.

## Repository support files

1. Add or update `.gitignore` with standard .NET build output, test output, IDE-user state, and local development exclusions while preserving relevant existing ignores.
2. Add `.editorconfig` with baseline C#/.NET formatting and text-file conventions.
3. Add or update the root `README.md` with prerequisites and exact commands to:
   - restore the solution;
   - build the solution;
   - run the API in Development;
   - call the health endpoint;
   - open the OpenAPI document and Swagger UI;
   - run automated tests.
4. Shared compiler settings may be placed in `Directory.Build.props`; they must not suppress compiler diagnostics globally.

## Automated test

1. Add at least one integration-style automated test that boots the API in memory and sends `GET /health`.
2. The test must assert HTTP 200.
3. The application entry point must be exposed to the test assembly only as needed to support the in-memory host.

## Acceptance criteria

The ticket is accepted only when all of the following are demonstrated by governed validation:

1. `dotnet restore IssueTracker.sln` succeeds using the prepared offline dependency set.
2. `dotnet build IssueTracker.sln --no-restore` succeeds.
3. `dotnet test IssueTracker.sln --no-build --no-restore` succeeds and includes the health-endpoint/startup test.
4. The API starts locally in Development.
5. `GET /health` returns HTTP 200.
6. `/openapi/v1.json` and `/swagger` are available in Development.
7. The final diff is limited to the work item's accepted paths and contains no database, authentication, issue CRUD, Docker, or deployment implementation.
8. The repository's fixed validation commands and toolchain have first been updated by an authorized repository setup change so that criteria 1-3 can be executed inside workflow policy.

## Out of scope

- Database providers, schemas, migrations, seed data, or persistence abstractions.
- Authentication or authorization.
- Issue entities, issue CRUD endpoints, or business workflows.
- Dockerfiles, container orchestration, or container deployment.
- CI/CD and production deployment configuration.
- Frontend implementation.
- Removal or migration of the repository's existing Node workflow fixture unless separately authorized.

## Known prerequisite

The current governed validation image and command set are Node-only. Implementation and validation must not bypass that restriction. Before the implementation session can complete, an authorized repository setup change must provide a pinned .NET 10 validation image, fixed restore/build/test commands, and offline-available NuGet dependencies, then restore `ai-delivery doctor --json` to `ready: true`.
