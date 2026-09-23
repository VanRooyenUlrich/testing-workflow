# POC-001 Discovery

## Ticket

Create the initial C#/.NET backend application for the Issue Tracker proof of concept. The scope is application structure, development-time API documentation, baseline HTTP behavior, and a health endpoint. Database access, authentication, issue CRUD, Docker, and deployment are excluded.

## Current repository state

- The repository has a committed baseline and was clean when discovery began.
- The existing application is a minimal Node.js workflow fixture with `src/index.js` and `test/index.test.js`. It does not contain a .NET solution, projects, or a pinned .NET SDK.
- Installed SDKs are .NET 8.0.206, 9.0.121, and several .NET 10 SDKs. The active/current SDK is 10.0.300.
- The repository workflow is initialized, its OPA policy service is ready, Docker is available, and `ai-delivery doctor --json` reports `ready: true`.
- The work item has a `STANDARD` risk profile and uses an isolated candidate worktree.

## Proposed structure

- `IssueTracker.sln`: solution entry point.
- `global.json`: pin the available .NET 10.0.300 SDK for reproducible local commands.
- `Directory.Build.props`: shared nullable, implicit-using, warning, and language defaults where appropriate.
- `src/IssueTracker.Api`: ASP.NET Core Web API host.
- `src/IssueTracker.Core`: domain/core project with no infrastructure dependency.
- `src/IssueTracker.Infrastructure`: infrastructure project that may depend on Core.
- `tests/IssueTracker.Api.Tests`: automated API/startup tests.
- Root `.editorconfig`, `.gitignore`, and `README.md` updated for the .NET solution.

Expected project dependency direction:

```text
IssueTracker.Api -> IssueTracker.Core
IssueTracker.Api -> IssueTracker.Infrastructure
IssueTracker.Infrastructure -> IssueTracker.Core
IssueTracker.Api.Tests -> IssueTracker.Api
```

No database or business-domain implementation is needed in this ticket. Dependency-injection registration should establish clean extension points without inventing out-of-scope services.

## Expected behavior

- Target .NET 10, the current installed SDK and current LTS line in this environment.
- Register ASP.NET Core health checks and map `GET /health`; a healthy application returns HTTP 200.
- Register Problem Details and use centralized exception handling so unhandled API failures use an RFC 7807-compatible response.
- Publish OpenAPI only in the Development environment. The exact exposed route should be documented in the README.
- Configure a named CORS policy from configuration rather than hard-coding policy logic. Unless the product owner supplies a different value before specification acceptance, use `http://localhost:5173` as the development frontend origin.
- Add an integration-style automated test that starts the API in memory and verifies `GET /health` returns HTTP 200.

## Constraints and risks

1. The governed command set currently contains only `npm run lint` and `npm run test`, executed in a pinned Node image. It has no .NET SDK image and no fixed commands for `dotnet restore`, `dotnet build`, or `dotnet test`.
2. The implementation session must not run undeclared commands or bypass the workflow. Therefore the acceptance criteria for restore, build, application startup, and automated .NET tests cannot be validated by the present governance configuration.
3. The API test and normal OpenAPI support are expected to require NuGet packages. Governed validation has networking disabled, so the prepared toolchain must include an appropriate .NET SDK image and an offline-restorable package set before validation.
4. Governance files are deliberately outside this feature ticket's affected paths and must not be modified as ordinary feature work. A repository administrator must add and prepare the .NET validation toolchain separately.
5. The ticket names a frontend development origin but does not state its value. The proposed value is `http://localhost:5173`; this assumption must be accepted or replaced before implementation.
6. Existing Node fixture files and package metadata are not part of this ticket's allowed paths. They should remain untouched unless the ticket scope is explicitly expanded.

## Required repository preparation before implementation can complete

- Configure fixed governed commands that cover .NET restore, build, and test (or an equivalent single command set that proves all three).
- Pin a Linux .NET 10 SDK validation image by digest and prepare/verify the corresponding offline toolchain.
- Ensure all required NuGet packages can restore with validation networking disabled.
- Re-run `ai-delivery doctor --json` and require `ready: true` after that change.

## Open question

- Confirm that the frontend development origin is `http://localhost:5173`; otherwise provide the required origin.

## Discovery conclusion

The application design and file scope are straightforward and fit a `STANDARD` work item. Specification and planning can proceed, but governed implementation/validation must pause until the repository's fixed toolchain supports .NET 10 and the CORS origin assumption is accepted or corrected.
