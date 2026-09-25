# POC-002 Implementation Plan

## Preconditions and controls

1. Use the accepted `STANDARD` profile and mutate only `frontend/**`, `.gitignore`, `README.md`, and the root `package.json`. The only permitted `package.json` mutation is changing the root `test` script from `node --test` to `node --test test/*.test.js`; dependencies, workspaces, and every other manifest field remain unchanged.
2. Begin implementation only after interactive approval of this exact plan.
3. Start a new governed implementation session and perform every candidate read/write through its advertised `ai-delivery` MCP tools with optimistic revisions.
4. Reuse the committed Next.js, React, TypeScript, ESLint, Vitest, jsdom, and React Testing Library dependencies. Do not add packages unless an unexpected implementation constraint is reported and approved.
5. Do not modify backend, workflow, governance, API contracts, authentication, database, Docker, deployment, or CI files.

## Step 1: Confirm the implementation baseline

- Read the accepted specification and the current `frontend/` files through the implementation session.
- Use the advertised `status`, `file_list`, `file_read`, and `git_status` MCP tools to confirm the session is current and the isolated candidate matches its baseline before writing.
- Rely on each optimistic `file_create` or `file_replace` operation to enforce project governance and the work item's accepted affected paths. Do not call `scope_validate` or `final_diff_validate` before a candidate-bound handoff exists.
- Confirm the placeholder page/test from setup commit `181dc17` are the only product-facing baseline elements to replace.
- Confirm no candidate or host drift exists.

## Step 2: Add configuration and API-client behavior

Create or update these files within `frontend/**`:

- `frontend/lib/config.ts`: expose the normalized public backend base URL, using `NEXT_PUBLIC_API_BASE_URL` when nonblank and `http://localhost:5080` otherwise.
- `frontend/lib/api-client.ts`: centralize URL joining and implement the `GET /health` request. Return successfully for any 2xx response; throw a safe status-oriented error for non-2xx responses and propagate network failure without coupling to a response body.
- `frontend/lib/config.test.ts` and/or `frontend/lib/api-client.test.ts`: cover the default URL, configured URLs with and without a trailing slash, GET URL/method, successful 2xx handling, and non-2xx behavior.

Implementation details:

- Keep environment access isolated to the configuration module.
- Avoid logging the configured URL or error internals from shared service code.
- Use the platform `fetch`; do not introduce an HTTP library.

## Step 3: Implement the backend-status client component

Create:

- `frontend/components/backend-status.tsx`: a client component that starts the health request after mount and renders loading, available, or unavailable status.
- `frontend/components/backend-status.test.tsx`: component tests with controlled `fetch` promises.

Required behavior:

- Mark the status region busy while loading.
- Render explicit text for available and unavailable states; do not depend on color alone.
- Show Retry only after failure, disable it during a retry, and transition correctly from failure to success.
- Guard each request attempt so a stale completion cannot overwrite the newest attempt.
- Present safe user-facing text without stack traces or raw internal errors.

Tests will cover initial loading, successful 2xx, network rejection, non-2xx, retry from failure to success, disabled retry while pending, and stale-attempt protection where practical.

## Step 4: Build the App Router shell and home page

Update:

- `frontend/app/layout.tsx`: set Issue Tracker metadata, import global styles, and render the header, accessible navigation/Home link, and main-content region.
- `frontend/app/page.tsx`: replace setup placeholder content with the home introduction and `BackendStatus` component.
- `frontend/app/page.test.tsx`: replace the setup-only assertion with meaningful home/layout-facing content assertions, avoiding duplicate component tests.
- `frontend/app/globals.css`: add lightweight responsive layout and status styling, visible focus styles, readable contrast, and no remote assets.

Keep the page itself server-renderable except for the isolated health-status client component.

## Step 5: Update documentation, root-test scoping, and ignores

- Update the root `README.md` without removing backend instructions.
- Update only the root `package.json` `test` script from `node --test` to `node --test test/*.test.js` so the governed root Node suite does not discover frontend Vitest tests. Do not change dependencies, workspaces, or any other manifest field.
- Document `npm ci` from the repository root, optional `NEXT_PUBLIC_API_BASE_URL`, backend Development startup, frontend development on port 5173, production build/start, lint, tests, and expected health states.
- Explain that local `.env` files are uncommitted and show a shell-specific configuration example without adding an environment file.
- Recheck `.gitignore`; change it only if implementation produces another local artifact not already covered.

## Step 6: Run governed checks and submit the handoff

Run only fixed command IDs advertised by governance, stopping on any denial, stale state, drift, or failure:

1. `frontend:install`
2. `frontend:lint`
3. `frontend:test`
4. `frontend:build`
5. `lint`
6. `test`
7. `dotnet:restore`
8. `dotnet:build`
9. `dotnet:test`

The order runs fast frontend feedback before the complete regression set. If any candidate change affects a declaration hashed by the prepared toolchain, stop and request the required toolchain refresh rather than bypassing stale-toolchain enforcement.

After the fixed commands pass:

- Inspect `changed_paths` and `git_diff` and verify the candidate contains only accepted paths and intended behavior.
- Submit a candidate-bound implementation handoff summarizing changed files, state behavior, test coverage, passing fixed-command receipts, and the runtime-verification boundary.
- Do not mutate the candidate after handoff; any required correction must return through the governed revision path and produce a new handoff.

## Step 7: Run formal validation

- Only after `handoff_submit` succeeds, run formal `validation run` for the candidate-bound session.
- Allow formal validation to perform its required command and final diff/scope checks; do not invoke `scope_validate` or `final_diff_validate` before handoff.
- Verify the formal validation result is bound to the current candidate snapshot, governance hash, capability manifest, and handoff.
- Stop on any denial, stale state, drift, missing command evidence, or validation failure.

## Step 8: Runtime verification boundary

- The implementation must preserve `dev` and `start` scripts on port 5173 and document the backend/frontend local smoke procedure.
- Existing governed commands prove clean dependency installation, production compilation, linting, component/service behavior, and backend regressions.
- Governance currently has no fixed command that launches both long-running servers or performs a browser smoke test against a live backend. Do not run undeclared commands to manufacture that evidence. If live runtime proof is required before review/promotion, stop and request a separately authorized fixed smoke command; otherwise treat the documented procedure plus governed build/tests and code review as the available evidence.

## Step 9: Independent review

- Start a separate read-only review session after formal validation passes.
- Review the accepted specification, plan, diff, tests, validation evidence, accessibility/error handling, configuration exposure, and absence of out-of-scope features.
- Record the independent review decision. Do not preview or apply promotion until the workflow reaches that stage and the exact required human confirmation is obtained.

## Expected file impact

Expected additions:

- `frontend/app/globals.css`
- `frontend/components/backend-status.tsx`
- `frontend/components/backend-status.test.tsx`
- `frontend/lib/config.ts`
- `frontend/lib/config.test.ts`
- `frontend/lib/api-client.ts`
- `frontend/lib/api-client.test.ts`

Expected modifications:

- `frontend/app/layout.tsx`
- `frontend/app/page.tsx`
- `frontend/app/page.test.tsx`
- `README.md`
- `package.json` (root `test` script only)

Conditional modification only if required:

- `.gitignore`

No dependency, workspace, or lockfile change is expected. The root package-manifest change is limited to the accepted `test` script scoping update.

## Rollback approach

Before promotion, discard or revise the isolated candidate through governed workflow operations; the host remains unchanged. After promotion, normal version-control reversion of the POC implementation paths is sufficient because this ticket adds no persistence, migration, external resource, or deployment side effect.
