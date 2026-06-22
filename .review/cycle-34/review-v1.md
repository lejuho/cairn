# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Scheduler env parsing is unvalidated and untested

- Location: `server/src/index.ts:73`
- Analysis: `WATCHER_DAILY_PUSH_HOUR` and
  `WATCHER_DAILY_PUSH_MINUTE` are parsed with `Number.parseInt` and passed
  directly to `msUntilNextLocalTime`. Invalid values such as `abc` produce
  `NaN`; `setTimeout(..., NaN)` can run immediately. Out-of-range values such
  as `99` are normalized by `Date` instead of rejected. The scheduler boundary
  is also not covered by fake-clock/unit tests: the integration tests cover
  `runWatcherDailyPush`, but not disabled-by-default startup, next-run timing,
  invalid env handling, or overlap skip behavior in `startWatcherDailyPushScheduler`.
- Impact: Violates the plan input contract for
  `WATCHER_DAILY_PUSH_HOUR=0..23` and
  `WATCHER_DAILY_PUSH_MINUTE=0..59`, plus the Review Guidance requirement that
  scheduler timing be verified with unit/fake-clock tests. In production, a bad
  env value could trigger an immediate unexpected watcher digest.
- Fix direction: Move scheduler config/timing into a testable helper or module.
  Validate hour/minute ranges; on invalid env, log and do not start the
  scheduler. Add fake-clock tests for disabled default, missing Telegram config,
  valid next-run scheduling, invalid hour/minute, and no-overlap behavior.

### ISSUE-2 [LOW] Deploy env example omits new watcher scheduler flags

- Location: `deploy/env/cairn-server.env.example:21`
- Analysis: Cycle 34 introduces production env flags
  `WATCHER_DAILY_PUSH_ENABLED`, `WATCHER_DAILY_PUSH_HOUR`, and
  `WATCHER_DAILY_PUSH_MINUTE`. `docs/codebase-map.md` documents them, but the
  deploy env example still only lists the existing Telegram polling variables.
- Impact: Violates the plan docs requirement to update the deploy env example
  when new env flags are introduced. Operators copying the example will not see
  that watcher push is disabled by default or how to enable it safely.
- Fix direction: Add commented watcher daily push variables near the Telegram
  block, including the disabled default and hour/minute ranges.

## Sprint Contract Check

- Due armed kind-A watcher rows produce a calm single digest: PASS.
- Future, disarmed, unsupported, and actively snoozed watchers produce no push:
  PASS.
- Watchers that already have `last_fired` on the same local `date` produce no
  duplicate push: PASS.
- Successful delivery updates `last_fired` for exactly sent watcher ids: PASS.
- Failed delivery does not update `last_fired`: PASS.
- Scheduler is disabled by default: PARTIAL. Code checks the env flag, but the
  scheduler startup path lacks the required fake-clock/unit coverage.
- Enabling scheduler without Telegram configuration fails/logs gracefully and
  does not mutate watcher rows: PARTIAL. Code path appears guarded, but tests
  only simulate a failing injected sender; they do not cover the actual
  scheduler startup boundary.
- Scheduler/job code has no LLM, GCal, Gmail, crawler, or external watcher-B
  dependency: PASS.
- Existing `/api/watchers`, `/api/today`, and `/watch` behavior remains
  compatible: PASS by full verify.
- `docs/codebase-map.md` reflects the new job boundary: PASS.
- Deploy env example reflects new env flags: FAIL, see ISSUE-2.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- Static boundary check for LLM/GCal/Gmail/crawler/n8n imports in watcher push
  service/job/script: PASS, no hits
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 149 PASS
  - server unit tests: 186 PASS
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
- ISSUE-2: APPLY

### Applied

RESOLVED: ISSUE-1 — Scheduler extracted to testable module with env validation + fake-clock tests
- `server/src/jobs/watcher-push-scheduler.ts` (NEW): `parseSchedulerConfig()` reads env in one place; `startWatcherDailyPushScheduler()` accepts typed config + injectable `runJob` — no `process.env` inside. Validates `hour` (0-23) and `minute` (0-59); NaN or out-of-range → `logError` + return null. `msUntilNextLocalTime(hour, minute, now?)` takes optional `now` parameter for deterministic tests.
- `server/src/jobs/watcher-push-scheduler.test.ts` (NEW): 14 unit tests with `vi.useFakeTimers()`. Covers: disabled-by-default, missing botToken, missing chatId, NaN hour, out-of-range hour (99), NaN minute, out-of-range minute (60), valid timing (future today), valid timing (already-past wraps), 24h repeat interval, overlap skip, plus 3 `msUntilNextLocalTime` pure-function cases.
- `server/src/index.ts`: removed inline scheduler. Now calls `parseSchedulerConfig()` + `startWatcherDailyPushScheduler()`.
자동 체크: lint ✅ / typecheck ✅ / test 407/407 ✅ / build ✅

RESOLVED: ISSUE-2 — Deploy env example updated with watcher push flags
- `deploy/env/cairn-server.env.example`: added commented watcher push block above Telegram section — `WATCHER_DAILY_PUSH_ENABLED=false`, `WATCHER_DAILY_PUSH_HOUR=9 (0-23)`, `WATCHER_DAILY_PUSH_MINUTE=0 (0-59)`.
자동 체크: lint ✅ / typecheck ✅ / test 407/407 ✅ / build ✅
