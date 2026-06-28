# Watcher And Record Modes A Implementation Plan

Branch: feature/cycle-71-watcher-record-modes-a
Cycle: 71
Created: 2026-06-28
Skills: frontend-react-pwa

## Summary

Cycle 70 made Today use the shared compact Composer. The next roadmap item is
**Cycle 71: Watcher And Record Modes A** from
`docs/composer-roadmap-cycles-68-71.md`.

This cycle adds the next two Composer object modes: `Watcher` and `기록`.
Implementation stays frontend-only by reusing existing backend contracts:
watcher creation uses the current `/api/watchers`, `/api/watchers/reverse-plan`,
and `/api/watchers/manual-exogenous` routes; record capture uses the existing
event-linked annotation route `POST /api/events/:id/annotations`. No standalone
diary storage, backend route, shared schema, DB migration, LLM prompt, watcher-B
crawling, n8n pipeline, or Mirror rewrite is introduced.

## Input/Output Spec

- Input:
  - Existing `/input` data loads continue to use:
    - `GET /api/today?date=...&now=...`;
    - `GET /api/threads`;
    - best-effort people load for advanced event form.
  - Existing Today data loads continue to use:
    - `GET /api/today?domain=...&date=...&now=...`.
  - Shared Composer modes become:
    - `/input`: `일정 | 스레드 | 할 일 | Watcher | 기록`;
    - Today compact Composer: `일정 | 스레드 | 할 일 | Watcher | 기록`.
  - Existing Cycle 69/70 mode mapping remains unchanged:
    - `일정` → `POST /api/capture/flat-event` with `{ text, now }`;
    - `스레드` → `POST /api/threads/draft` with `{ text }`;
    - `할 일` → `POST /api/tasks` with `{ title }`.
  - New `Watcher` mode:
    - central text input is the watcher label and is always required;
    - an explicit watcher subtype control chooses one of:
      - `날짜 기반` → existing `POST /api/watchers` with `{ label, threshold, category? }`;
      - `역산 계획` → existing `POST /api/watchers/reverse-plan` with
        `{ label, category?, targetDate, targetLabel?, safetyDays, steps }`;
      - `수동 확인` → existing `POST /api/watchers/manual-exogenous` with
        `{ label, category?, sourceLabel?, sourceUrl?, sourceStability }`;
    - subtype-specific required fields are explicit UI controls, not hidden
      natural-language parsing.
  - New `기록` mode:
    - central text input is the record/annotation text and is required;
    - the user explicitly selects an existing event target from Today-owned
      event data before submit:
      - Today: scheduled day events and event-bearing cards available in the
        current surface;
      - `/input`: scheduled day events plus unscheduled Cairn events available
        from the same Today surface load.
    - submit uses existing `POST /api/events/:id/annotations` with `{ text }`.
- Normal output:
  - Existing `일정`, `스레드`, and `할 일` result cards remain unchanged.
  - `Watcher` success renders a `Watcher` `ResultCard` with:
    - created watcher label or subtype label;
    - status text indicating which watcher kind was created;
    - primary action `지켜볼 것에서 보기` linking to `/watch`.
  - `기록` success renders a `기록` `ResultCard` with:
    - target event title;
    - parse status when available (`parsed` or `raw_stored`);
    - primary action explaining where to review it:
      - Today can open/refetch the event detail path when practical, otherwise
        link to `/today`;
      - `/input` links to `/today`;
    - secondary copy that event-linked notes appear in event detail and relevant
      Mirror diary/reflection views.
  - Successful watcher or record submit clears the Composer text and keeps the
    selected mode.
  - Today refreshes after successful watcher/record actions so derived cards,
    watcher bubbles, or event details can reflect new data.
  - `/input` reloads its Today surface after record submit so event/annotation
    context stays current.
- Failure behavior:
  - Empty text cannot submit.
  - Watcher subtype fields are client-side required before submit where the
    existing API requires them.
  - Record mode cannot submit without an explicit event target.
  - API failures are scoped Composer errors and preserve typed text, selected
    mode, and subtype/target selections.
  - LLM annotation parse failure still follows the existing annotation route
    behavior: raw text is stored by the backend and result shows raw/uncertain
    status instead of fabricating parsed structure.
  - No hidden auto-routing: selected mode and explicit subtype/target controls
    determine the endpoint.
  - No automatic watcher-B crawling, no n8n pipeline, no standalone diary table,
    no new Mirror write path, and no backend/schema/DB/LLM changes.

## Key Changes

- Frontend:
  - `web/src/CreationComposer.tsx`
    - Extend `ComposerMode` to include `watcher` and `record`.
    - Preserve presentational-only boundary.
    - Add an optional detail/action slot below the central input so page owners
      can render watcher subtype controls and record target selectors without
      putting API calls into the shared component.
  - `web/src/InputHub.tsx`
    - Add `Watcher` and `기록` modes to the full Composer.
    - Preserve existing `일정`, `스레드`, `할 일`, advanced input, unscheduled
      event list, slot candidate, and people behavior.
    - Keep enough Today surface data to offer record target events.
    - Route Watcher mode through existing watcher endpoints.
    - Route Record mode through existing event annotation endpoint.
    - Reuse `ResultCard` for Watcher and Record success.
  - `web/src/Today.tsx`
    - Add `Watcher` and `기록` modes to the compact Composer.
    - Preserve Today queue/card priority, event detail sheets, conflict
      resolution, slot candidates, watcher cards, feasibility controls,
      preparation suggestions, manual intake sheet, and domain filter.
    - Route Watcher and Record modes through existing endpoints only.
    - Reuse `ResultCard` for Watcher and Record success.
  - `web/src/Watchers.tsx`
    - Extract small constants/helpers for watcher subtype labels and request
      helpers only if useful.
    - Do not regress the existing `/watch` create bottom sheet.
  - `web/src/Today.test.tsx` and `web/src/InputHub.test.tsx`
    - Add watcher/record mode rendering, endpoint routing, result, and failure
      tests.
    - Preserve existing Composer and screen behavior tests.
  - `web/src/Watchers.test.tsx`
    - Adjust only if helper extraction changes local imports or labels; existing
      create-flow tests must still pass.
  - `web/src/styles.css`
    - Add semantic-token styles for subtype controls, record target selector,
      and compact/full mode detail panels.
- Docs:
  - `docs/composer-roadmap-cycles-68-71.md`
    - Mark Cycle 71 as promoted and keep it as the active cycle.
  - `docs/codebase-map.md`
    - Update because shared Composer modes and Today/InputHub creation routes
      change materially.

## Sprint Contract

- Passing criteria:
  - `/input` and Today Composer each expose exactly five modes:
    `일정`, `스레드`, `할 일`, `Watcher`, `기록`.
  - Existing `일정`, `스레드`, and `할 일` behavior from Cycles 69-70 remains
    unchanged.
  - `Watcher` mode has explicit subtype selection for `날짜 기반`, `역산 계획`,
    and `수동 확인`.
  - `Watcher` mode routes each subtype to the existing endpoint with the exact
    existing request shape:
    - date threshold → `/api/watchers`;
    - reverse plan → `/api/watchers/reverse-plan`;
    - manual exogenous → `/api/watchers/manual-exogenous`.
  - `Watcher` mode success renders a `Watcher` `ResultCard` linking to `/watch`.
  - `기록` mode requires an explicit event target and posts only to
    `/api/events/:id/annotations` with `{ text }`.
  - `기록` mode success renders a `기록` `ResultCard` explaining that the note is
    event-linked and visible through event detail / relevant Mirror views.
  - Empty text, missing watcher subtype fields, and missing record event target
    cannot submit.
  - API failures preserve typed text, selected mode, watcher subtype fields, and
    record target.
  - Shared `CreationComposer` remains presentational-only: no fetch, no apiJson,
    no navigation, no ResultCard/result construction.
  - Today top-level loading, quiet, live, error, and access-session states remain
    available.
  - Existing Today card priority, event detail, conflict resolution,
    notification draft sheet, slot candidate preview/apply/dismiss, watcher
    cards, feasibility controls, preparation suggestions, manual intake sheet,
    and domain filter remain available.
  - Existing `/input` advanced event/task forms, unscheduled list, slot
    scheduling, and people controls remain available.
  - Existing `/watch` create bottom sheet and watcher card behaviors remain
    available.
  - New CSS uses semantic tokens only and all new controls are 44px+.
  - No backend route, shared API contract, DB schema, migration, LLM prompt,
    automatic watcher-B crawling, n8n pipeline, standalone diary storage, or
    Mirror rewrite is introduced.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
- Test cases:
  - `/input` renders all five modes and preserves the three existing mode tests.
  - Today renders all five modes and preserves the three existing mode tests.
  - Switching to `Watcher` shows subtype controls and does not submit.
  - Date-threshold watcher submit calls only `POST /api/watchers` with label and
    threshold.
  - Reverse-plan watcher submit calls only `POST /api/watchers/reverse-plan`
    with target date, safety days, and one or more steps.
  - Manual-exogenous watcher submit calls only
    `POST /api/watchers/manual-exogenous` with label/source fields.
  - Watcher success result card links to `/watch`.
  - Watcher API failure preserves label/subtype fields and shows local error.
  - `기록` mode renders an event target selector when current surface has event
    targets.
  - `기록` mode blocks submit when no target is selected.
  - `기록` submit calls only `POST /api/events/:id/annotations` with `{ text }`.
  - `기록` parsed and raw-stored responses render a record result card without
    inventing parsed fields.
  - Record API failure preserves text and selected target.
  - Existing `/watch` create-flow tests still pass.
  - Existing Today queue/detail/slot/watcher/feasibility tests still pass.
  - Static negative checks:
    - No backend/shared/DB changes:
      `git diff --name-only master...HEAD | rg '^(server|shared)/|^server/drizzle/'`
      should have no matches.
    - No new external/LLM/schema/diary scope:
      `git diff -U0 master...HEAD -- web/src docs | rg -n 'standalone diary|CREATE TABLE|ALTER TABLE|completeChat|LLM_PROXY_BASE_URL|n8n|crawler|crawl|mirror write|/api/mirror.*POST'`
      should have no implementation matches outside roadmap/plan text.
    - Shared Composer purity:
      `rg -n 'fetch\\(|apiJson|/api/|ResultCard|href=|window\\.location' web/src/CreationComposer.tsx`
      should have no matches.
    - Today card priority stays unchanged:
      `git diff -U0 master...HEAD -- web/src/Today.tsx | rg -n 'priority|cards\\.map|surface\\.cards|case \"conflict\"|case \"watcher\"|case \"next_event\"|case \"two_minute_task\"|case \"needs_review\"|case \"schedule_prompt\"|case \"task_schedule_prompt\"'`
      should show no semantic reordering.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Record mode can have no eligible event targets in a quiet day. It must show a
  quiet disabled state or explicit target-needed message, not fabricate a diary
  entry.
- Reverse-plan watcher creation can become a large form. Keep the A-slice
  bounded: reuse existing route shapes and support up to the existing max 8
  steps, but do not add natural-language decomposition or backend parsing.
- Annotation intake depends on the LLM gateway after raw storage. The UI must
  treat raw-stored output as a valid stored record with lower certainty, not as
  a failed write.

## Simpler Alternative

Add only links from the Composer to `/watch` and event detail without creating
watchers or records.

Rejected because the roadmap names these as Composer modes and expects creation
feedback. The A-slice can still stay frontend-only by using existing watcher and
annotation endpoints.

## Assumptions

- Cycle 70 is merged into `master`, so `CreationComposer` is shared by `/input`
  and Today.
- Existing watcher endpoints are sufficient for this cycle; no new backend
  parsing or storage is required.
- `기록` means event-linked annotation in this cycle. Standalone diary capture is
  out of scope.
- Today and `/input` can derive record target options from the existing Today
  surface data without adding a new API.
- If a record should appear in Mirror, it appears through existing
  annotation-backed Mirror reads, not through a new Mirror write route.

## Review Guidance

### Enumeration Required

- Shared Composer modes and purity:
  - Search:
    `rg -n "ComposerMode|watcher|record|CreationComposer|apiJson|fetch\\(|ResultCard" web/src/CreationComposer.tsx`
  - Expected: five-mode type support and no API/result/nav code inside the
    shared component.
- `/input` mode routing:
  - Search:
    `rg -n "watcher|record|manual-exogenous|reverse-plan|/api/watchers|/api/events/.*/annotations|thread-draft-success|task-result|capture-result|고급 입력" web/src/InputHub.tsx web/src/InputHub.test.tsx`
  - Expected: five modes, watcher/record endpoint routing, existing mode/result
    coverage, advanced input preserved.
- Today mode routing:
  - Search:
    `rg -n "watcher|record|manual-exogenous|reverse-plan|/api/watchers|/api/events/.*/annotations|thread-draft-success|task-result|capture-result|today-add-btn|DomainFilterControl" web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: five modes, watcher/record endpoint routing, existing queue/manual
    controls preserved.
- `/watch` preservation:
  - Search:
    `rg -n "date_threshold|reverse_plan|manual_exogenous|/api/watchers|manual-log|Watcher 추가" web/src/Watchers.tsx web/src/Watchers.test.tsx`
  - Expected: existing create bottom sheet and watcher cards still covered.
- Future-roadmap leakage:
  - Search:
    `git diff -U0 master...HEAD -- web/src docs | rg -n "standalone diary|CREATE TABLE|ALTER TABLE|n8n|crawler|crawl|LLM_PROXY_BASE_URL|completeChat|/api/mirror.*POST"`
  - Expected: matches only in roadmap/plan text, not implementation code.

### Verification Method Guide

- Watcher/record Composer behavior is frontend routing against existing APIs.
  Component/page tests are sufficient.
- Existing backend route behavior is already covered by integration tests; no new
  backend integration test is required because the plan forbids backend/schema
  changes.
- Record raw-storage behavior should be tested at UI contract level using the
  existing response shape; do not mock a new parser result.
- `corepack pnpm test:integration` and `corepack pnpm verify` still run as
  safety checks because this touches Today, `/input`, and watcher creation.
