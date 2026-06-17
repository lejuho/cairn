# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] `GET /api/threads` order is oldest-first, not newest-first
- 위치: server/src/repositories/threads.ts:21
- 분석: Cycle 9 plan requires `GET /api/threads` to return threads sorted by newest first. `listThreads` currently uses `orderBy(asc(threads.createdAt))`, so it returns oldest-created rows first. The integration tests only verify counts and do not assert list order.
- 영향: Sprint Contract item "`GET /api/threads` returns summaries with stable counts" passes, but the explicit API output contract "`sorted by newest first`" is not met.
- 수정 방향: Change list ordering to newest first, preferably `desc(threads.createdAt)` with an `id` desc tie-breaker if available. Add an integration test that creates at least two threads and asserts the newest thread appears first.

### ISSUE-2 [LOW] Workspace `git diff --check` fails on uncommitted spec edit
- 위치: docs/cairn-spec.md:388
- 분석: `git diff --check` fails because the current working tree has trailing whitespace in `docs/cairn-spec.md`. This file was already a user edit outside Cycle 9 and is not part of `master...HEAD`.
- 영향: The Sprint Contract automatic check `git diff --check` is not fully green in the current workspace, although `git diff --check master...HEAD` passes for the Cycle 9 implementation diff.
- 수정 방향: Handle the user-owned `docs/cairn-spec.md` edit intentionally: either fix the trailing whitespace in that doc as a separate docs change, commit it separately, or keep it excluded and run the cycle-scope diff check for review.

## Sprint Contract Check
- `POST /api/threads` creates active thread rows: PASS.
- `GET /api/threads` returns summaries with counts: PASS.
- `GET /api/threads` sorted newest first: FAIL. See ISSUE-1.
- `GET /api/threads/:id` returns thread, linked events/tasks, and progress: PASS.
- Missing thread returns `404 NOT_FOUND`: PASS.
- `/threads/:id` renders read-only spine and loading/live/empty/error states: PASS.
- Today links to thread detail only for events with `threadId`: PASS by source/test enumeration.
- No LLM dependency, graph editing, or natural-language generation: PASS.
- No migration added: PASS.
- `docs/codebase-map.md` updated: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm test:integration`: PASS, 95 tests
- `corepack pnpm verify`: PASS
- `git diff --check`: FAIL, due to user-owned `docs/cairn-spec.md` trailing whitespace outside Cycle 9 diff
- `git diff --check master...HEAD`: PASS

## Changes Outside Plan
- `package.json` updates `verify` to run `corepack pnpm --filter @cairn/shared build` before integration tests. This is outside the Cycle 9 feature scope, but it is plausibly justified by the existing `@cairn/shared` runtime export from `shared/dist`.
- `docs/cairn-spec.md` has an uncommitted user edit in the working tree. It is not included in `master...HEAD` and should not be overwritten by Cycle 9 fixes.

## Review Guidance Verification
### Enumeration Needed
- Thread API surface:
  - `rg -n "api/threads|ThreadRow|ThreadDetail|CreateThread" shared/src server/src web/src`: PASS.
- Route inventory:
  - `rg -n "app\\.(get|post|patch|put|delete)\\(" server/src/routes`: PASS. New thread routes are limited to `POST /api/threads`, `GET /api/threads`, and `GET /api/threads/:id`.
- LLM boundary:
  - `rg -n "LLM_PROXY_BASE_URL|completeChat|createLlmGateway|/v1/chat/completions" server/src web/src`: PASS. No new thread LLM dependency.
- Migration boundary:
  - `find server/drizzle -maxdepth 2 -type f -print | sort`: PASS. No new migration.
- Codebase map:
  - `rg -n "threads|/threads|Thread" docs/codebase-map.md`: PASS.

## Notes
- Progress calculation excludes cancelled/dropped states as planned.
- Thread detail event ordering handles null `start` values last as planned.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: DEFER (이유: user-owned `docs/cairn-spec.md` edit outside cycle 9 scope. `git diff --check master...HEAD` passes for cycle 9 diff. Will not modify user content without explicit intent.)

### Applied
RESOLVED: ISSUE-1 — listThreads sort changed to desc(createdAt), desc(id)
- `server/src/repositories/threads.ts:25`: `asc(threads.createdAt)` → `desc(threads.createdAt), desc(threads.id)`; imported `desc` from drizzle-orm
- `server/src/routes/threads.integration.test.ts`: added "returns list sorted newest-first" test asserting second-inserted thread appears at index 0
자동 체크: verify ✅ / test:integration 96 passed ✅
