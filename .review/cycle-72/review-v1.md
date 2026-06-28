# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Committed test code fails TypeScript typecheck
- Location: server/src/maps/gateway.test.ts:35
- Analysis: `corepack pnpm typecheck` fails in the committed gateway test because `fetchImpl.mock.calls[0]![0]` is inferred from an empty tuple/possibly undefined call. TypeScript reports TS2352 and TS2493.
- Impact: The Sprint Contract requires `corepack pnpm typecheck` and `corepack pnpm verify` to pass. The branch is not mergeable while typecheck fails.
- Fix direction: Type the mock call access explicitly and safely. For example, define the mock with a typed `fetch` signature, assert the first call exists, then narrow the first argument before treating it as a `URL`.

### ISSUE-2 [HIGH] Required route smoke test is untracked and would not merge
- Location: server/src/routes/maps.test.ts:1
- Analysis: `server/src/routes/maps.test.ts` exists in the working tree and covers the diagnostic route, but Git does not track it (`git ls-files --error-unmatch server/src/routes/maps.test.ts` fails). `git diff --name-status master...HEAD` also omits it.
- Impact: The plan explicitly requires `server/src/routes/maps.test.ts` coverage for disabled success, mock success, and typed failure without a DB. Current worktree tests may include this file, but the merge commit would not. That makes the verification non-reproducible from committed HEAD and leaves a Sprint Contract test gap after merge.
- Fix direction: Add the route test file to the implementation commit, then rerun the automatic checks from a clean staged/committed state.

## Sprint Contract Check
- `MAP_PROVIDER` defaults to `disabled`; existing server startup and existing routes do not require map credentials: PASS by inspection.
- `MAP_PROVIDER=google` requires `MAP_PROVIDER_API_KEY`; missing or blank key is a typed configuration error: PASS by inspection and committed config tests.
- All map provider calls go through one server gateway module: PASS by inspection.
- Google implementation uses server-side `fetch`; no client/browser SDK or browser-exposed key is introduced: PASS.
- Provider timeout is bounded and testable with injected `fetch`: PASS by inspection.
- Retry behavior is bounded and only applies to retryable unavailable/server failures: PASS by inspection.
- Google provider statuses are mapped explicitly: PASS by inspection.
- Diagnostic route has no arbitrary address parameter and does not become Cycle 73 geocoding API: PASS by inspection.
- Diagnostic route works in disabled mode without a provider call: BLOCKED until the required route test is tracked (ISSUE-2).
- Diagnostic route can be tested with a mock/injected gateway/fetch and no real network: BLOCKED until the required route test is tracked (ISSUE-2).
- No route returns provider raw payloads, raw `error_message`, coordinates as persisted facts, or API key material: PASS by inspection.
- No DB schema, Drizzle migration, repository, event persistence, Today aggregation, feasibility logic, frontend, PWA, or map UI change is made: PASS by static negative check.
- Existing LLM gateway behavior and LLM env vars remain unchanged: PASS by inspection.
- `docs/codebase-map.md` reflects the new map boundary: PASS by changed file presence; content should be rechecked after fixes.

## Automatic Checks
- `corepack pnpm lint`: PASS
- `corepack pnpm typecheck`: FAIL
  - `server/src/maps/gateway.test.ts:35` TS2352 / TS2493
- `corepack pnpm test`: NOT RUN after typecheck failure
- `corepack pnpm test:integration`: NOT RUN after typecheck failure
- `corepack pnpm build`: NOT RUN after typecheck failure
- `corepack pnpm verify`: NOT RUN after typecheck failure
- `git diff --check master...HEAD`: PASS
- No frontend or DB/migration changes: PASS. Static negative check returned no matches.
- Provider keys/public env check: PASS. Static negative check returned no matches.
- No Cycle 73+ persistence/UI/travel-time scope: PASS. Matches were limited to roadmap/plan text.

## Changes Outside Plan
None identified in committed implementation scope.

## Review Notes
- `server/src/routes/maps.test.ts` is intentionally not staged by this review because it is implementation/test scope, not a review artifact. Executor should commit it with the fix.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED
