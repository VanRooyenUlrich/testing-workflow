# POC-002 Discovery

## Ticket

Create the initial Issue Tracker React frontend with Next.js App Router and TypeScript. The frontend must render a basic application shell and home page, call the backend `GET /health` endpoint through a reusable client, show loading/available/unavailable states, include frontend tests, and document install/configure/run/test usage. Issue CRUD, authentication, Docker, and deployment are excluded.

## Current repository state

- The repository is on `main` and contains the completed POC-001 .NET 10 backend.
- The backend maps `GET /health` and returns HTTP 200 when healthy.
- Development CORS permits `http://localhost:5173`; documented backend local startup uses `http://localhost:5080`.
- Commit `181dc17` is a separately authorized workflow/toolchain prerequisite. It provides a minimal Next.js/TypeScript workspace under `frontend/`, a Vitest/React Testing Library baseline, root npm workspace wiring, and governed `frontend:install`, `frontend:build`, `frontend:lint`, and `frontend:test` commands.
- The pinned offline toolchain has been prepared successfully and all nine configured Node, frontend, and .NET commands pass.
- The workflow package now treats Codex `0.150.0` as the minimum compatible version and accepts higher semantic versions. The replacement discovery session accepts the installed `codex-cli 0.155.0-alpha.16`.
- No Issue Tracker product UI, health API client, availability component, final application layout, or product documentation has been implemented.

## Proposed implementation shape

- Extend `frontend/app/layout.tsx` with the Issue Tracker title/header, navigation, metadata, and main-content shell.
- Extend `frontend/app/page.tsx` with the home-page content and a client-side backend status component.
- Add reusable configuration and API client modules under `frontend/lib/`.
- Add the health status component under `frontend/components/`.
- Add or extend component/API tests under `frontend/` using the prepared Vitest, jsdom, and React Testing Library setup.
- Add basic global styling under `frontend/app/` without a component framework.
- Update the root README for frontend installation, environment configuration, startup, build, lint, and test instructions.
- Update `.gitignore` only if implementation introduces another generated local artifact not already covered.

## Runtime behavior

- The browser client reads `NEXT_PUBLIC_API_BASE_URL`; local development defaults to `http://localhost:5080`.
- The reusable API client normalizes the base URL and requests `/health`.
- A 2xx health response means available. Network errors and non-2xx responses mean unavailable.
- The home page exposes visible loading, available, and unavailable states and permits retry after failure.
- The frontend development and production scripts use port 5173, matching the existing backend CORS origin.

## Testing and validation

- Component tests will mock `fetch`; they will not require a live backend.
- Tests will cover the home content, loading state, successful health response, unavailable response, and retry behavior.
- API/configuration tests will cover URL construction and base-URL normalization.
- Governed validation will require `frontend:install`, `frontend:build`, `frontend:lint`, and `frontend:test`, plus all existing backend and repository checks.

## Scope and risk

- Risk profile: `STANDARD`.
- Accepted affected paths: `frontend/**`, `.gitignore`, and `README.md`.
- No configured high-risk affected-path or requested-command rule is triggered.
- Backend source, API contracts, authentication, database, infrastructure, Docker, deployment, governance, and workflow package files are outside the POC implementation scope.

## Assumptions requiring specification acceptance

1. The intended identifiers are work item `POC-002` and project `app`.
2. The frontend remains in the existing `frontend/` npm workspace.
3. Local frontend and backend ports are 5173 and 5080 respectively.
4. `NEXT_PUBLIC_API_BASE_URL` defaults to `http://localhost:5080` and may be overridden locally.
5. The browser calls the backend directly using its existing CORS policy.
6. Any HTTP 2xx response from `/health` means available; response-body parsing is unnecessary.
7. An initial request plus a manual retry is sufficient; continuous polling is out of scope.
8. The prepared Vitest and React Testing Library stack is accepted.

## Discovery conclusion

The repository and governed toolchain are ready for this ticket. The implementation can remain inside the accepted paths and `STANDARD` risk profile. No further governance or toolchain prerequisite is known.