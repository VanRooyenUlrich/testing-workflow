# POC-002 Specification

## Objective

Extend the prepared Next.js App Router workspace into the initial Issue Tracker frontend. Deliver a basic application shell and home page that prove browser-to-backend communication by calling `GET /health` and presenting clear loading, available, and unavailable states. Do not implement issue management, authentication, Docker, or deployment.

## Existing baseline

1. Use the separately committed `frontend/` workspace and its pinned Next.js, React, TypeScript, ESLint, Vitest, jsdom, and React Testing Library dependencies.
2. Preserve the root npm workspace and governed frontend commands established by setup commit `181dc17`, except for the narrow root `test` script change from `node --test` to `node --test test/*.test.js`. That exception keeps the root Node test command scoped to repository workflow tests instead of discovering frontend Vitest files; it must not change dependencies, workspaces, or any other manifest field.
3. The setup-only placeholder content and baseline test may be replaced by the product implementation and meaningful tests.
4. Do not modify workflow package, governance, backend source, API contracts, or .NET project files as part of POC-002.

## Application layout and home page

1. The App Router root layout must define suitable Issue Tracker page metadata and render:
   - a visible Issue Tracker title/header;
   - a navigation area with an accessible Home link;
   - a main content region containing route content.
2. The home route `/` must render introductory Issue Tracker content and a backend-status section.
3. Use semantic HTML, visible keyboard focus, readable contrast, and status text that does not depend on color alone.
4. Add basic responsive styling with repository-owned CSS. Do not add a component framework, design system, external font request, or image dependency.

## Backend configuration

1. Read the browser-visible backend base URL from `NEXT_PUBLIC_API_BASE_URL`.
2. When the variable is absent or blank, use `http://localhost:5080` as the local-development default.
3. Normalize trailing slashes before joining the `/health` path so configured values with or without a trailing slash produce one valid URL.
4. Keep configuration access in a reusable module rather than reading environment variables throughout UI components.
5. Do not commit `.env` or `.env.*` files. The README must document how a developer may set `NEXT_PUBLIC_API_BASE_URL` locally.

## API client

1. Add a small reusable browser API client/service under `frontend/lib/`.
2. The health operation must issue `GET {baseUrl}/health` using `fetch`.
3. Any HTTP 2xx response is a successful health result. The response body is not required and must not be coupled to a particular health payload format.
4. A non-2xx response must produce an error containing a safe status-oriented message.
5. A network rejection must be surfaced to the calling component as an error without exposing internal stack traces or secrets in the UI.
6. Do not add authentication headers, issue endpoints, caching libraries, or state-management dependencies.

## Health status UI

1. The health request must originate from a client component after the home page mounts, proving browser-to-backend communication rather than only server-side reachability.
2. While the initial request or a retry is pending, display a visible loading state and mark the status region busy for assistive technology.
3. On a successful 2xx response, display an explicit message that the backend is available.
4. On a network failure or non-2xx response, display an explicit message that the backend is unavailable.
5. The unavailable state must provide a Retry control that repeats the request.
6. Disable the Retry control while a retry is pending and prevent stale request completions from replacing the current attempt's result.
7. This ticket requires an initial request and manual retry only; periodic polling is out of scope.

## Local integration

1. `npm run dev --workspace frontend` must start the frontend on `http://localhost:5173`.
2. `npm run start --workspace frontend` must serve the production build on port 5173.
3. The default backend URL is `http://localhost:5080`, matching existing backend documentation.
4. The existing backend CORS policy for `http://localhost:5173` must be used without backend changes.

## Automated tests

1. Keep the existing Vitest, jsdom, and React Testing Library setup; tests must not require a live backend.
2. Mock `fetch` at the browser boundary and restore mocks between tests.
3. Cover at least:
   - application/home content rendering;
   - the initial loading state;
   - the available state for a successful 2xx response;
   - the unavailable state for a network rejection;
   - the unavailable state for a non-2xx response;
   - retry behavior from failure to success;
   - base-URL defaulting and trailing-slash normalization.
4. Replace the setup-only placeholder assertion with tests of the delivered behavior.

## Documentation and repository support

1. Update the root `README.md` while preserving backend instructions.
2. Document prerequisites and exact commands to:
   - install all dependencies from the repository root with `npm ci`;
   - configure `NEXT_PUBLIC_API_BASE_URL`;
   - start the backend in Development;
   - start the frontend on port 5173;
   - create a production frontend build;
   - start that production build;
   - run frontend lint and tests.
3. Document the expected available and unavailable health-status behavior.
4. Update `.gitignore` only if another generated local frontend artifact is introduced and not already ignored.

## Acceptance criteria

POC-002 is accepted only when governed validation and review demonstrate all of the following:

1. `frontend:install` passes against the pinned root lockfile and reports the frontend workspace dependencies.
2. `frontend:build` produces a successful Next.js production build in the pinned offline Node toolchain.
3. `frontend:lint` passes.
4. `frontend:test` passes and includes the required health/configuration coverage.
5. All pre-existing root Node and .NET restore/build/test commands continue to pass.
6. The frontend starts locally on port 5173 and `/` renders the specified layout and home content.
7. With the backend running at the configured base URL, the browser calls `GET /health` and shows backend available for a 2xx response.
8. With the backend stopped, unreachable, or returning non-2xx, the UI shows backend unavailable and offers Retry.
9. The final diff is limited to `frontend/**`, `.gitignore`, `README.md`, and `package.json`. Any `package.json` change is limited to changing the root `test` script from `node --test` to `node --test test/*.test.js`; the diff contains no dependency, workspace, workflow, governance, backend, authentication, issue CRUD, Docker, or deployment changes.

## Out of scope

- Issue list or issue detail UI.
- Create, edit, or delete issue flows.
- Authentication, authorization, or user management.
- Database or backend API changes.
- Docker or container orchestration.
- Deployment, hosting, or CI/CD.
- Continuous health polling, telemetry, or production monitoring.
- A third-party UI framework or state-management library.

## Accepted assumptions required to proceed

1. Work item `POC-002` and project `app` are the intended identifiers.
2. The frontend remains under `frontend/`.
3. Local ports are frontend 5173 and backend 5080.
4. `NEXT_PUBLIC_API_BASE_URL` defaults to `http://localhost:5080`.
5. The frontend calls the backend directly from the browser using existing CORS configuration.
6. Any 2xx `/health` response means available; the response body is not part of this contract.
7. Initial load plus manual retry is sufficient; polling is excluded.
8. The prepared Vitest and React Testing Library stack is accepted.
9. The root `package.json` test-script scoping change is accepted so the pre-existing Node suite remains distinct from frontend Vitest discovery.
