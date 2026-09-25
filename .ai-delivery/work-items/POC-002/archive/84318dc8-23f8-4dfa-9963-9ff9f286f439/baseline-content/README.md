# Issue Tracker backend

Initial ASP.NET Core backend for the Issue Tracker proof of concept. This ticket provides the solution structure, health endpoint, development API documentation, CORS policy, Problem Details, and an integration test. It does not include persistence, authentication, issue CRUD, Docker, or deployment.

## Prerequisites

- .NET 10 SDK. The repository pins SDK 10.0.300 and permits compatible feature-band roll-forward.
- Node.js 22 or newer and Docker Desktop when running the governed AI Delivery validation workflow.

## Restore and build

```powershell
dotnet restore IssueTracker.sln
dotnet build IssueTracker.sln --no-restore
```

## Run locally

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --project src/IssueTracker.Api/IssueTracker.Api.csproj --urls http://localhost:5080
```

The development frontend origin allowed by CORS is `http://localhost:5173`. Change `Cors:AllowedOrigins` in `src/IssueTracker.Api/appsettings.Development.json` if the frontend uses a different development origin.

With the API running:

- Health: `http://localhost:5080/health`
- OpenAPI JSON: `http://localhost:5080/openapi/v1.json`
- Swagger UI: `http://localhost:5080/swagger`

Check health from PowerShell:

```powershell
Invoke-WebRequest http://localhost:5080/health
```

## Test

```powershell
dotnet test IssueTracker.sln --no-build --no-restore
```

For a standalone test run that performs its own restore and build, use:

```powershell
dotnet test IssueTracker.sln
```

## Governed validation

The repository AI Delivery workflow runs fixed Node and .NET checks in pinned offline containers. Use `ai-delivery work next --id POC-001` to determine the next permitted workflow action.
