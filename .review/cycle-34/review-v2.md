# Codex Review v2

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Scheduler env parsing still accepts partial numeric strings

- Location: `server/src/jobs/watcher-push-scheduler.ts:17`
- Analysis: The scheduler logic was extracted and now has good range guards and
  fake-clock coverage for `NaN`, out-of-range hour/minute, valid timing, and
  overlap. However, `parseSchedulerConfig` still uses `Number.parseInt`.
  Strings such as `WATCHER_DAILY_PUSH_HOUR=9abc` and
  `WATCHER_DAILY_PUSH_MINUTE=0foo` parse as valid `9` and `0`. Those values do
  not satisfy the plan input contract of `0..23` and `0..59`; they are malformed
  env values that should fail closed instead of silently starting the scheduler.
- Impact: The v1 scheduler-env issue is not fully closed. A typo in production
  env can still start the daily watcher push at an unintended time, which is
  exactly the class of failure the validation fix was meant to prevent.
- Fix direction: Parse with full-string integer validation, for example a
  helper that accepts only `/^\d+$/` before `Number(...)`, then range-checks.
  Add tests for trailing junk strings such as `9abc` and `0foo`.

### ISSUE-3 [LOW] Diff whitespace check fails

- Location: `server/src/index.ts:69`
- Analysis: `git diff --check master..HEAD` reports
  `server/src/index.ts:69: new blank line at EOF.` This is a mechanical
  whitespace failure in a file touched by the scheduler refactor.
- Impact: Violates the automatic check requirement. Merge cannot proceed while
  `git diff --check` fails.
- Fix direction: Remove the extra EOF blank line and rerun `git diff --check`.

## Previous Issue Status

- ISSUE-1: UNRESOLVED
  - Scheduler extraction, range checks, and fake-clock tests were added.
  - Full-string env parsing is still missing because `parseInt` accepts partial
    numeric strings.
- ISSUE-2: RESOLVED
  - `deploy/env/cairn-server.env.example` now documents the watcher daily push
    flags, disabled default, and hour/minute ranges.

## Regression Check

No behavior regression found in watcher push selection or job idempotency. The
remaining problems are env parsing strictness and a whitespace check failure.

## Sprint Contract Check

- Due armed kind-A watcher rows produce a calm single digest: PASS.
- Future, disarmed, unsupported, and actively snoozed watchers produce no push:
  PASS.
- Watchers that already have `last_fired` on the same local `date` produce no
  duplicate push: PASS.
- Successful delivery updates `last_fired` for exactly sent watcher ids: PASS.
- Failed delivery does not update `last_fired`: PASS.
- Scheduler is disabled by default: PASS.
- Enabling scheduler without Telegram configuration fails/logs gracefully and
  does not mutate watcher rows: PASS.
- Scheduler hour/minute env values are validated as `0..23` and `0..59`:
  PARTIAL, see ISSUE-1.
- Scheduler timing has fake-clock coverage: PASS.
- Scheduler/job code has no LLM, GCal, Gmail, crawler, or external watcher-B
  dependency: PASS.
- Existing `/api/watchers`, `/api/today`, and `/watch` behavior remains
  compatible: PASS by full verify.
- `docs/codebase-map.md` reflects the new job boundary: PASS.
- Deploy env example reflects new env flags: PASS.

## Automatic Checks

- `git diff --check master..HEAD`: FAIL
  - `server/src/index.ts:69: new blank line at EOF.`
- `corepack pnpm db:generate`: PASS, no schema changes
- Static boundary check for LLM/GCal/Gmail/crawler/n8n imports in watcher push
  service/job/scheduler/script: PASS, no hits
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 149 PASS
  - server unit tests: 200 PASS
  - web unit tests: 275 PASS
  - shared build: PASS
  - server SQLite integration tests: 407 PASS
  - production build/PWA generation: PASS

## Changes Outside Plan

None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-1 — parseWholeInt helper replaces parseInt; trailing-junk strings now fail closed
- `server/src/jobs/watcher-push-scheduler.ts`: `parseWholeInt(str: string | undefined)` exported. `/^\d+$/` regex — rejects signed, floating-point, hex, whitespace-padded, and trailing-junk strings (returns NaN). `parseSchedulerConfig()` uses `parseWholeInt` instead of `Number.parseInt`.
- `server/src/jobs/watcher-push-scheduler.test.ts`: 12 tests added — `parseWholeInt` unit (valid: 0/9/23/59, trailing-junk: "9abc"/"0foo", negative: "-5"/"+9", empty/undefined) + scheduler-level trailing-junk cases ("9abc" hour, "0foo" minute → null + log).
자동 체크: lint ✅ / typecheck ✅ / test 407/407 ✅ / build ✅

RESOLVED: ISSUE-3 — EOF blank line removed from server/src/index.ts
- Removed extra trailing newline. `git diff --check master..HEAD` passes after commit.
자동 체크: lint ✅ / typecheck ✅ / git diff --check ✅
