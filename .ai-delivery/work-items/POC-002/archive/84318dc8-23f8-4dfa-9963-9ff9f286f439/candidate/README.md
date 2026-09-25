# Issue Tracker

Initial Issue Tracker proof of concept with an ASP.NET Core backend and a Next.js App Router frontend. The frontend provides the application shell, home page, and browser-based backend health status. Persistence, authentication, issue CRUD, Docker, and deployment are not included.

## Prerequisites

- .NET 10 SDK. The repository pins SDK 10.0.300 and permits compatible feature-band roll-forward.
- Node.js 22.12 or newer with npm.
- Docker Desktop when running the governed AI Delivery validation workflow.

## Install frontend dependencies

Install the pinned root and frontend workspace dependencies from the repository root:

```powershell
npm ci
```

## Configure the backend URL

The frontend reads `NEXT_PUBLIC_API_BASE_URL` and defaults to `http://localhost:5080` when it is absent or blank. To use another backend for the current PowerShell session:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL = 'http://localhost:5080'
```

Local `.env` and `.env.*` files are ignored and must not be committed.

## Run locally

Start the backend in Development mode:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --project src/IssueTracker.Api/IssueTracker.Api.csproj --urls http://localhost:5080
```

In another terminal, start the frontend on `http://localhost:5173`:

```powershell
npm run dev --workspace frontend
```

The backend development CORS policy already permits `http://localhost:5173`. Change `Cors:AllowedOrigins` in `src/IssueTracker.Api/appsettings.Development.json` only if the frontend uses a different development origin.

With both applications running, open `http://localhost:5173`. The home page initially shows a loading state and then reports `Backend is available.` for any successful 2xx response from `GET /health`. If the backend is unreachable or returns a non-2xx response, it reports `Backend is unavailable.` and provides a Retry button.

Backend development endpoints:

- Health: `http://localhost:5080/health`
- OpenAPI JSON: `http://localhost:5080/openapi/v1.json`
- Swagger UI: `http://localhost:5080/swagger`

Check backend health directly from PowerShell:

```powershell
Invoke-WebRequest http://localhost:5080/health
```

## Build and run the production frontend

Create the production build:

```powershell
npm run build --workspace frontend
```

Serve that build on `http://localhost:5173`:

```powershell
npm run start --workspace frontend
```

## Lint and test the frontend

```powershell
npm run lint --workspace frontend
npm run test --workspace frontend
```

Frontend tests use mocked browser requests and do not require a running backend.

## Restore, build, and test the backend

```powershell
dotnet restore IssueTracker.sln
dotnet build IssueTracker.sln --no-restore
dotnet test IssueTracker.sln --no-build --no-restore
```

For a standalone backend test run that performs its own restore and build, use:

```powershell
dotnet test IssueTracker.sln
```

## Governed validation

The repository AI Delivery workflow runs fixed Node, frontend, and .NET checks in pinned offline containers. Use `ai-delivery work next --id POC-002` to determine the next permitted workflow action.