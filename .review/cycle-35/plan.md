# Watcher Reverse Planning A Implementation Plan

Branch: feature/cycle-35-watcher-reverse-planning-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 35 adds the first deterministic reverse-planning watcher.

Current state:

- Watcher A date-threshold registration, `/watch` deep view, Today surface, and
  daily Telegram digest push are implemented.
- The DB already has `watchers.rule`, `watchers.threshold`, `tasks.due`, and
  generic `links` with kind `requires`.
- There is no reverse-planning rule, no latest-safe-start calculation, and no
  UI for "target date + lead-time chain".

This cycle implements FR-WAT-08 A-level reverse planning:

- create a reverse-plan watcher from `/watch`;
- store the chain in `watchers.rule`;
- create one task per step and `links.requires` edges in a single transaction;
- compute latest safe dates backwards from a target date;
- expose the computed chain in `/watch`;
- surface/push the watcher through the existing Watcher A due machinery using
  the next incomplete milestone threshold.

Out of scope:

- watcher B crawling or keyword search;
- external data, Gmail, GCal, maps, or LLM calls;
- editing reverse-plan chains after creation;
- deleting watcher-created tasks/links;
- automatic templates/presets for passport/visa/etc.;
- schedule-slot assignment for generated tasks;
- migration, unless the existing `watchers`, `tasks`, and `links` tables prove
  insufficient.

## Input/Output Spec

- Input:
  - `POST /api/watchers/reverse-plan`
    - Body:

```json
{
  "label": "여권 갱신",
  "category": "travel",
  "targetDate": "2026-07-30",
  "targetLabel": "출국",
  "safetyDays": 3,
  "steps": [
    { "label": "여권 신청", "leadDays": 21 },
    { "label": "항공권 정보 확인", "leadDays": 2 }
  ]
}
```

  - Validation:
    - `label`: non-empty string;
    - `category`: optional string;
    - `targetDate`: strict `YYYY-MM-DD`, overflow rejected;
    - `targetLabel`: optional non-empty string, defaults to `label`;
    - `safetyDays`: integer `0..30`, default `0`;
    - `steps`: ordered execution chain, length `1..8`;
    - each `step.label`: non-empty string;
    - each `step.leadDays`: integer `0..365`;
    - computed milestone dates must not overflow and must remain valid dates.

- Reverse calculation:
  - Steps are listed in execution order.
  - Start with `cursor = targetDate`.
  - Walk steps from last to first:
    - `latestDate = cursor - leadDays`;
    - for the first step only, subtract `safetyDays` as well;
    - set that step's generated task `due = latestDate`;
    - set `cursor = latestDate`.
  - `watchers.threshold` is the earliest not-done step's `latestDate`.
  - If all generated step tasks are done, the watcher remains visible in
    `/watch` as completed/quiet and does not surface in Today or push.

- Stored watcher rule:

```json
{
  "type": "reverse_plan",
  "targetDate": "2026-07-30",
  "targetLabel": "출국",
  "safetyDays": 3,
  "steps": [
    {
      "label": "여권 신청",
      "leadDays": 21,
      "latestDate": "2026-07-04",
      "taskId": 42
    }
  ],
  "targetTaskId": 44
}
```

- `links.requires` direction:
  - Downstream node `from` requires upstream prerequisite `to`.
  - Example:
    - target task requires last step task;
    - step 2 requires step 1.
  - All generated links use `kind='requires'`, `firmness='hard'`,
    `source='authored'`.

- Output:
  - `POST /api/watchers/reverse-plan`
    - Returns `{ watcher, tasks, links, reversePlan }`.
    - The response includes the same computed chain that `/watch` will render.
  - `GET /api/watchers?date&now`
    - Existing date-threshold rows remain compatible.
    - Reverse-plan rows include a `reversePlan` object on `WatcherDeepRow`
      with target date, safety days, steps, next step, and completion state.
  - Today and daily push:
    - Reverse-plan watcher appears only when the next incomplete milestone
      threshold is reached and not snoozed/disarmed.
    - Message stays descriptive: "여권 신청을 시작할 때야" / "N일 지난 역산 watcher야".

- Failure:
  - Invalid input returns stable validation error.
  - Any task/link/watcher transaction failure rolls back all generated rows.
  - Malformed stored reverse-plan rule is shown as `unsupported`, never due.

## Key Changes

- Shared:
  - Extend `shared/src/watchers.ts` with:
    - `CreateReversePlanWatcherRequestSchema`;
    - `ReversePlanStepSchema`;
    - `ReversePlanDataSchema`;
    - optional `reversePlan` field on `WatcherDeepRowSchema`;
    - reason codes for reverse-plan due/pending/completed if using typed codes.
  - Keep strict schemas. Reject injected `score`, `recommendation`, automatic
    action, or fabricated certainty fields.

- Backend:
  - Add a pure reverse-planning service, for example
    `server/src/services/watcher-reverse-plan.ts`.
    - Validate calendar dates with round-trip checks.
    - Compute milestone latest dates deterministically.
    - Resolve next incomplete step from generated task statuses.
    - Return `unsupported` on malformed stored rules.
    - No DB, no network, no LLM.
  - Extend watcher repository:
    - create reverse-plan watcher + generated tasks + requires links in one
      SQLite transaction;
    - fetch generated tasks needed to evaluate reverse-plan rule status;
    - update `watchers.threshold` when generated task completion shifts the next
      incomplete milestone, if needed.
  - Extend `server/src/routes/watchers.ts`:
    - `POST /api/watchers/reverse-plan`;
    - keep existing date-threshold POST/snooze/armed/list behavior unchanged.
  - Extend Watcher A evaluation boundaries:
    - `buildWatcherDeepView` shows reverse-plan data and status;
    - `evaluateWatcherA` can surface reverse-plan due rows in Today;
    - `selectDueForPush` can include reverse-plan due rows in the daily digest;
    - all three must share the same threshold derivation or a common helper.
  - Do not add LLM/GCal/Gmail/network calls.

- Frontend:
  - Extend `web/src/Watchers.tsx` only.
  - Create sheet supports two modes:
    - existing date-threshold watcher;
    - reverse-plan watcher.
  - Reverse-plan form:
    - label, optional category;
    - target label, target date;
    - safety days;
    - ordered step rows with label + lead days;
    - add/remove step, min 1/max 8.
  - Reverse-plan cards:
    - show target date;
    - show next incomplete step and latest safe date;
    - show full chain in order;
    - preserve armed toggle and due snooze behavior.
  - UI constraints:
    - A-temperature execution surface;
    - semantic tokens only;
    - touch targets at least 44px;
    - reduced-motion safe;
    - no alarmist styling or fake precision.

- Docs:
  - Update `docs/codebase-map.md` with:
    - reverse-plan watcher route;
    - pure service;
    - repository transaction boundary;
    - `/watch` reverse-plan UI;
    - Today/push reverse-plan evaluation note.

## Sprint Contract

- Pass criteria:
  - Reverse-plan watcher creation is atomic: watcher, generated tasks, and
    `links.requires` all commit or all roll back.
  - Generated link direction is exactly downstream `requires` upstream.
  - Latest safe dates are computed by walking the chain backward from
    `targetDate`.
  - `safetyDays` only subtracts from the first actionable step.
  - Date overflow and malformed dates are rejected or classified unsupported,
    never silently normalized.
  - `/watch` lists reverse-plan watchers with target, next step, latest safe
    date, and chain details.
  - Disarmed reverse-plan watchers remain visible in `/watch` but do not appear
    in Today or daily push.
  - Snoozed reverse-plan watchers show `snoozed` in `/watch` and stay hidden
    from Today/push until `snoozedUntil <= now`.
  - Completed reverse-plan chains stay visible in `/watch` as completed/quiet
    and do not surface as due.
  - Existing date-threshold watcher behavior, Today watcher bubbles, and daily
    push digest remain compatible.
  - No LLM, GCal, Gmail, external crawling, n8n, or network dependency is
    introduced.
  - `docs/codebase-map.md` updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static boundary check for no LLM/GCal/Gmail/crawler/n8n imports in new
    reverse-plan watcher path.

- Test cases:
  - Unit:
    - 1-step reverse plan latest date;
    - multi-step reverse walk ordering;
    - safetyDays applied only to first step;
    - threshold exactly today due;
    - future threshold quiet;
    - completed chain not due;
    - malformed/overflow date unsupported or rejected;
    - stored rule with missing taskId fail-open unsupported.
  - SQLite integration:
    - successful create inserts watcher + generated tasks + requires links;
    - transaction rolls back if a generated link insert fails;
    - generated link direction: target requires last step, each later step
      requires previous step;
    - Today route surfaces due reverse-plan watcher and hides future/disarmed/
      snoozed/completed rows;
    - daily push sends due reverse-plan digest once and honors `last_fired`;
    - existing date-threshold watcher routes/tests still pass.
  - Web:
    - `/watch` keeps loading/quiet/live/error/access-session states;
    - date-threshold create still works;
    - reverse-plan create posts exact body and renders returned chain;
    - create failure keeps sheet open with error;
    - reverse-plan due card can snooze and toggle armed;
    - semantic token check for new CSS.
  - Manual:
    - Mobile/light/dark/reduced-motion source or headless evidence recorded if
      UI files change.

- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- A generated task is manually deleted or its id is missing from the DB. The
  reverse-plan watcher should show `unsupported` or degraded "task missing"
  state rather than fabricating completion.
- A user marks the first step done after it became due. The next incomplete
  step must become the threshold without re-alerting the completed step.
- The computed first latest date is before today at creation time. Creation is
  allowed, but the watcher is immediately due with honest overdue copy.

## Simpler Alternative

Store only `targetDate`, `steps`, and computed dates inside `watchers.rule`
without creating tasks or links.

Rejected because the spec explicitly says reverse planning uses the
`links.requires` machine. Creating task nodes plus hard/authored requires edges
keeps the chain inspectable by future thread/sequence features while still
avoiding a migration.

## Assumptions

- Reverse-plan A stores generated task ids in the watcher rule instead of adding
  a new join table.
- Generated tasks are enough for A-level completion tracking; editing/deleting
  those tasks is a later cycle.
- `links` currently lacks FK constraints and supports event/task node ids; this
  cycle must add integration tests because DB constraints alone will not prove
  graph correctness.
- `source='authored'` and `firmness='hard'` are valid because the user creates
  the reverse-plan chain explicitly.
- A single reverse-plan watcher creates at most 8 generated step tasks to keep
  UI and graph fan-out small.

## Review Guidance

### Enumeration Needed

- Watcher evaluators:
  - Search:
    `rg -n "evaluateWatcherA|buildWatcherDeepView|selectDueForPush|date_threshold|reverse_plan" server/src shared/src web/src`
  - Confirm date-threshold behavior did not regress and reverse-plan threshold
    semantics are consistent across Today, `/watch`, and daily push.

- Generated tasks and links:
  - Search:
    `rg -n "requires|links|insertLink|tasks|reverse_plan|CreateReversePlan" server/src shared/src`
  - Confirm transaction creates all rows and generated link direction is
    downstream requires upstream.

- External boundaries:
  - Search:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|crawler|n8n|fetch\\(" server/src/services server/src/routes server/src/repositories server/src/jobs`
  - Expected: no new reverse-plan path imports/calls these dependencies. Existing
    unrelated files may still match.

- UI scope:
  - Search:
    `rg -n "reversePlan|reverse_plan|watcher-create|watcher-card|#[0-9A-Fa-f]{3,6}|var\\([^)]*,\\s*#" web/src/Watchers.tsx web/src/styles.css`
  - Confirm new watcher UI uses semantic tokens only and keeps 44px actions.

### Verification Method Guide

- Reverse calculation:
  - Pure unit tests are sufficient for date arithmetic, chain ordering,
    safetyDays, and malformed rule classification.

- Atomic create:
  - Mock tests are insufficient. Use SQLite integration tests with a real
    temporary DB because links have weak FK enforcement and transaction rollback
    is the contract.

- Today/push integration:
  - Use route/job integration tests against a real temporary DB. Do not send
    real Telegram messages; inject fake sender.

- UI:
  - JSDOM tests are required for create/snooze/toggle/error states.
  - Manual browser checks may be replaced by explicit headless/source evidence
    only if browser access is unavailable; record the limitation in RESOLVED if
    needed.
