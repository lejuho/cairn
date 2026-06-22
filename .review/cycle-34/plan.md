# Watcher Cron / Push A Implementation Plan

Branch: feature/cycle-34-watcher-cron-push-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 34 completes the next Watcher A layer: a deterministic daily push job.

Current state:

- Watcher persistence exists in the `watchers` table, including `armed`,
  `threshold`, `last_fired`, and `snoozed_until`.
- `POST /api/watchers`, `PATCH /api/watchers/:id/snooze`, and
  `PATCH /api/watchers/:id/armed` exist.
- Today already surfaces due armed Watcher A rows when the user opens `/today`.
- `/watch` lists all watcher rows and explains due/quiet/snoozed/disarmed and
  unsupported states.
- A Telegram boundary already exists for push-style delivery, but watcher due
  evaluation is not scheduled or pushed.

This cycle adds a disabled-by-default, cron-ready Watcher A push path:

- a pure service that selects due watcher notifications;
- idempotency via `watchers.last_fired`;
- a one-shot job runner that sends a calm digest through an injected sender;
- optional in-process daily scheduling controlled by explicit env flags;
- a CLI/package script for local or external scheduler execution;
- tests proving no duplicate push after successful send and no mutation when
  delivery fails.

Out of scope:

- Watcher B external web monitoring, crawling, n8n, or keyword search;
- reverse planning / lead-time chains;
- Web Push implementation;
- notification preferences UI;
- watcher templates, deletion, bulk edit, or spending timelines;
- new DB columns or migrations unless existing `last_fired` proves unusable;
- any LLM, Gmail, GCal, or external network dependency beyond the existing
  Telegram sender boundary.

## Input/Output Spec

- Input:
  - In-process scheduler env:
    - `WATCHER_DAILY_PUSH_ENABLED=true|false` (default false);
    - `WATCHER_DAILY_PUSH_HOUR=0..23` (default chosen by implementation, e.g. 9);
    - `WATCHER_DAILY_PUSH_MINUTE=0..59` (default 0).
  - Existing Telegram env, reused only when watcher push is enabled:
    - `TELEGRAM_BOT_TOKEN`;
    - `TELEGRAM_CHAT_ID`;
    - `TELEGRAM_FORCE_IPV4` if already supported by the existing client.
  - One-shot CLI/script:
    - Uses `CAIRN_DB_PATH` like other server scripts.
    - Optional deterministic test flags may be added for `date` and `now`, but
      production default derives both from server time.

- Output:
  - When no watcher is due:
    - no Telegram message;
    - no database mutation;
    - job result reports `sentCount=0`.
  - When one or more armed kind-A watchers are due and not snoozed:
    - send one digest message, not one noisy message per watcher;
    - include label, optional category, threshold, and overdue days;
    - wording stays descriptive, not alarmist.
  - After successful delivery:
    - update `watchers.last_fired` for exactly the sent watcher ids;
    - a second run for the same local `date` sends nothing.
  - On delivery failure:
    - do not update `last_fired`;
    - return/log a failure result;
    - a later retry can send the same still-due digest.
  - Unsupported, disarmed, future-threshold, and actively snoozed watchers:
    - never push;
    - remain visible in `/watch` according to cycle 33 behavior.

## Key Changes

- Backend:
  - Add a pure notification selection/service module, for example
    `server/src/services/watcher-daily-push.ts`.
    - Input: watcher rows, `date`, `now`.
    - Reuse or intentionally mirror Watcher A date-threshold parsing discipline.
    - Honor `armed`, kind A, effective threshold, active snooze, and
      `last_fired`.
    - Output deterministic digest items and message text.
    - No DB, no network, no LLM.
  - Extend watcher repository with narrow helpers:
    - read rows needed for watcher push evaluation;
    - mark a set of watcher ids as fired using `last_fired = now`.
  - Add a job runner boundary, for example `server/src/jobs/watcher-daily-push.ts`.
    - Inject sender and clock for tests.
    - Read DB rows, build digest, send once, then mark fired.
    - Return a structured result for logs/tests.
  - Add optional scheduler startup wiring.
    - Disabled unless `WATCHER_DAILY_PUSH_ENABLED=true`.
    - Compute next configured local time, run once daily, and avoid overlapping
      executions if a previous run is still active.
    - Log failures without crashing the Fastify server.
  - Add one-shot script entrypoint, for example
    `server/scripts/watcher-daily-push.ts`.
    - Opens SQLite via existing DB utilities/migrations pattern.
    - Uses the same job runner as the scheduler.
    - Exits non-zero on delivery/config failure, zero when there is simply no
      due watcher.
  - Add package scripts only if needed:
    - server-level `watcher:push`;
    - root-level `watcher:push`.
  - Reuse existing Telegram client/sender boundary.
    - Do not put Telegram fetch calls inside the pure service.
    - Do not add a second Telegram implementation.

- Frontend:
  - No new primary screen.
  - Preserve existing Today and `/watch` behavior.
  - Add/adjust tests only if frontend-visible copy or state changes become
    necessary; otherwise keep this cycle backend-only in implementation.

- Docs:
  - Update `docs/codebase-map.md` with:
    - watcher daily push service/job/script;
    - new package script if added;
    - env flags and scheduler boundary.
  - Update deploy env example only if new env flags are introduced there.

## Sprint Contract

- Pass criteria:
  - Due armed kind-A watcher rows produce a calm single digest.
  - Future, disarmed, unsupported, and actively snoozed watchers produce no
    push.
  - Watchers that already have `last_fired` on the same local `date` produce no
    duplicate push.
  - Successful delivery updates `last_fired` for exactly sent watcher ids.
  - Failed delivery does not update `last_fired`.
  - Scheduler is disabled by default.
  - Enabling scheduler without Telegram configuration fails/logs gracefully and
    does not mutate watcher rows.
  - Scheduler/job code has no LLM, GCal, Gmail, crawler, or external watcher-B
    dependency.
  - Existing `/api/watchers`, `/api/today`, and `/watch` behavior remains
    compatible.
  - `docs/codebase-map.md` reflects the new job boundary.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - Focused backend unit tests for the pure selection/message service.
  - SQLite integration tests with a real temporary DB for job idempotency and
    delivery failure behavior.
  - Static boundary check proving watcher push service/job do not import the
    LLM gateway, GCal, Gmail, or watcher-B/network collection code.

- Test cases:
  - Unit:
    - due watcher selected with days overdue;
    - threshold exactly today selected with zero overdue days;
    - future watcher skipped;
    - disarmed watcher skipped;
    - active snooze skipped;
    - expired snooze selected;
    - malformed rule with valid threshold follows existing A fallback behavior
      or is explicitly documented if intentionally different;
    - unsupported kind skipped;
    - same-date `last_fired` skipped;
    - older `last_fired` selected.
  - Integration:
    - no due watchers: no sender call, no DB mutation;
    - two due watchers: exactly one digest sender call, both ids marked fired;
    - repeat same date: no duplicate sender call;
    - sender throws/rejects: no `last_fired` update;
    - scheduler/job config missing Telegram credentials: graceful failure, no
      mutation.
  - Manual:
    - Run one-shot script against a temporary/local DB fixture or dry-run mode.
    - Confirm no real Telegram message is sent during automated tests.

- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- A watcher is due, message send succeeds, but marking `last_fired` fails.
  Expected behavior must be documented; duplicate on next retry is acceptable
  only if the failure is logged clearly.
- Server restarts while a scheduled run is in progress. The job must avoid
  overlapping in one process; cross-process duplication is out of scope for a
  single Raspberry Pi deployment.
- Local date vs UTC date mismatch around midnight. The job must compare
  `last_fired` against the chosen local `date` consistently.

## Simpler Alternative

Only add a manual `pnpm watcher:push` script and rely on external cron.

Rejected for this cycle because FR-WAT-02 says the server owns daily watcher
evaluation. A one-shot script is still useful, but the app also needs an
explicit disabled-by-default in-process scheduler boundary so deployment can
turn it on without inventing another mechanism.

## Assumptions

- Existing `watchers.last_fired` is sufficient for per-day idempotency.
- A single digest per daily run is better than one push per watcher for the
  "여백은 침묵이 기본" product tone.
- Telegram is the first concrete push channel because the repository already
  has Telegram client/worker boundaries. Web Push remains a later cycle.
- Single-user Raspberry Pi deployment means in-process daily scheduling is
  acceptable for A-level; distributed locking is out of scope.
- Production scheduler defaults are disabled until env explicitly enables them.

## Review Guidance

### Enumeration Needed

- Watcher evaluation semantics:
  - Search:
    `rg -n "evaluateWatcherA|buildWatcherDeepView|lastFired|snoozedUntil|threshold|date_threshold" server/src shared/src`
  - Confirm the new push selector does not diverge from Today due behavior
    except for the intentional `last_fired` idempotency gate.

- Watcher DB write paths:
  - Search:
    `rg -n "lastFired|last_fired|setWatcher|watchers" server/src/repositories server/src/routes server/src/jobs server/src/services`
  - Confirm the job only mutates `last_fired` after successful delivery.

- External boundaries:
  - Search:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|crawler|n8n" server/src/services server/src/jobs server/scripts`
  - Expected: no hits in watcher push service/job/script, except unrelated
    files outside the new watcher push path.

- Scheduler startup:
  - Search:
    `rg -n "WATCHER_DAILY_PUSH|startWatcher|watcher.*push" server/src server/scripts package.json server/package.json deploy docs/codebase-map.md`
  - Confirm scheduler is disabled by default and documented.

### Verification Method Guide

- Idempotency and delivery-failure behavior:
  - Mock-only unit tests are insufficient because `last_fired` persistence is
    the contract.
  - Must use SQLite integration tests with a real temporary DB and an injected
    fake sender.

- Pure selector behavior:
  - Unit tests are sufficient for date arithmetic, snooze, malformed rule,
    unsupported kind, and message text ordering.

- Telegram delivery:
  - Do not send real Telegram messages in automated tests.
  - Use injected sender or a local fake. Real Telegram smoke is manual only and
    not required for merge unless the executor explicitly performs it.

- Scheduler timing:
  - Unit/fake-clock tests are sufficient for "disabled by default",
    "next run scheduled", and "no overlap".
  - Do not require waiting real wall-clock time.

- Existing UI/API compatibility:
  - `corepack pnpm verify` is required.
  - If no frontend files change, manual mobile UI checks are not required for
    this cycle; reviewer should verify no frontend behavior was changed.
