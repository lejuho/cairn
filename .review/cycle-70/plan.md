# Today Composer Adoption A Implementation Plan

Branch: feature/cycle-70-today-composer-adoption-a
Cycle: 70
Created: 2026-06-28
Skills: frontend-react-pwa

## Summary

Cycle 69 made `/input` the primary mode-selected Composer surface. The next
roadmap item is **Cycle 70: Today Composer Adoption A** from
`docs/composer-roadmap-cycles-68-71.md`.

This cycle replaces Today's event-only quick capture with a compact Composer
entry that uses the same explicit modes as `/input`: `일정`, `스레드`, and
`할 일`. Today must remain the processing queue: cards, event detail sheets,
conflict resolution, slot candidates, watcher cards, feasibility controls, and
the existing manual intake sheet stay functionally unchanged. This cycle does
not add Watcher or record/diary Composer modes and does not change backend,
shared schemas, DB migrations, LLM prompts, or Today card priority.

## Input/Output Spec

- Input:
  - Existing Today surface load remains unchanged:
    - `GET /api/today?date=...&now=...`.
  - Existing manual intake bottom sheet remains unchanged:
    - task creation through `POST /api/tasks`;
    - event creation through `POST /api/events`.
  - New compact Composer UI replaces the current quick capture form in both
    quiet and live Today states:
    - mode segmented control: `일정 | 스레드 | 할 일`;
    - one compact natural-language input;
    - one compact submit action.
  - Mode-to-existing-API mapping:
    - `일정`: submit text to existing `POST /api/capture/flat-event` with
      `{ text, now }`.
    - `스레드`: submit text to existing `POST /api/threads/draft` with
      `{ text }`.
    - `할 일`: submit text as the title to existing `POST /api/tasks` with
      `{ title }` only.
- Normal output:
  - `일정` scheduled success renders a cycle-68 `ResultCard` with kind `일정`
    and a Today refresh/view action.
  - `일정` raw/unscheduled success renders a `미정 일정` `ResultCard` with a
    `날짜 잡기` action pointing to the existing `/input` scheduling surface.
  - `스레드` success renders a `스레드 초안` `ResultCard` with:
    - created thread name;
    - counts for events/tasks/links;
    - warnings, if any;
    - primary action `스레드 열기` linking to `/threads/:id`.
  - `할 일` success renders a `할 일` `ResultCard` with a Today refresh/view
    action.
  - The compact Composer clears its text after a successful submit and remains
    on the selected mode.
  - Scheduled event and task success refresh Today so newly relevant queue
    items can appear without a full page reload.
  - Today's existing card stack and manual `+ 추가` sheet remain available.
- Failure behavior:
  - Empty Composer input is client-side rejected/disabled.
  - Mode-specific API failures show a local Composer error and preserve typed
    text and selected mode.
  - LLM/thread-draft unavailability is a scoped Composer error only; Today
    cards stay usable.
  - Existing Today load/error/access-session behavior remains unchanged.
  - No hidden auto-routing: the selected mode determines the endpoint.
  - No Watcher Composer mode, record/diary mode, Today card-priority change,
    backend route, shared API contract, DB schema, migration, LLM prompt, or
    external integration change is introduced.

## Key Changes

- Frontend:
  - `web/src/CreationComposer.tsx` (new)
    - Extract a small presentational Composer component from the Cycle 69
      `/input` Composer UI.
    - Data-in, callbacks-out only: selected mode, text, submitting state,
      label/placeholder config, and submit/mode/text callbacks.
    - No API calls, no navigation, no data fetching, no result construction.
    - Supports a compact variant for Today and the existing full variant for
      `/input`, if needed.
  - `web/src/InputHub.tsx`
    - Reuse the shared Composer component while preserving Cycle 69 behavior:
      modes, endpoint routing, result cards, advanced input, unscheduled event
      list, slot candidates, and tests.
  - `web/src/Today.tsx`
    - Replace the current quick capture form/state with compact Composer state:
      selected mode, text, submitting/error/result.
    - Route submits to the existing capture, thread-draft, or task endpoint
      based only on selected mode.
    - Reuse `ResultCard` for compact Composer success feedback.
    - Keep manual intake sheet, Today card rendering, event detail sheets,
      conflict resolution, slot candidates, watcher snooze, feasibility
      settings, preparation suggestions, and annotation flows unchanged.
  - `web/src/Today.test.tsx`
    - Replace quick-capture tests with compact Composer tests.
    - Preserve manual intake and high-value Today interaction tests.
  - `web/src/InputHub.test.tsx`
    - Adjust only if extracting the shared component changes accessible labels
      or DOM shape; behavior coverage must remain equivalent.
  - `web/src/styles.css`
    - Reuse or extend Composer semantic-token styles for compact Today layout.
    - Remove obsolete quick-capture-only styles only if no longer referenced.
- Docs:
  - `docs/composer-roadmap-cycles-68-71.md`
    - Mark Cycle 70 as promoted; keep Cycle 71 as roadmap only.
  - `docs/codebase-map.md`
    - Update because Today navigation and a reusable Composer component change
      material lookup paths.

## Sprint Contract

- Passing criteria:
  - Today quiet state renders the compact Composer and no longer renders the old
    event-only quick capture form.
  - Today live state renders the compact Composer without changing the existing
    card stack, timeline, or `+ 추가` manual intake affordance.
  - Compact Composer has exactly three modes in this cycle: `일정`, `스레드`,
    `할 일`.
  - Mode selection is explicit, visible, keyboard-focusable, and 44px+.
  - The selected mode alone determines the endpoint; there is no hidden
    classifier or auto-routing.
  - Empty Composer text cannot submit.
  - `일정` mode calls `POST /api/capture/flat-event` with `{ text, now }` and
    renders scheduled vs unscheduled/raw `ResultCard` feedback.
  - `스레드` mode calls `POST /api/threads/draft` with `{ text }` and renders a
    `스레드 초안` `ResultCard` with `/threads/:id` navigation, counts, and
    warnings.
  - `할 일` mode calls `POST /api/tasks` with `{ title }` only and renders a
    `할 일` `ResultCard`.
  - Composer submit failure keeps the selected mode and typed text and renders a
    local `role="alert"` error.
  - Today top-level loading, quiet, live, error, and access-session states remain
    available.
  - Existing manual intake bottom sheet behavior remains unchanged for task and
    event creation.
  - Existing Today card priority, event detail, conflict resolution,
    notification draft sheet, slot candidate preview/apply/dismiss, watcher
    cards, feasibility controls, preparation suggestions, and annotation flows
    remain available.
  - `/input` Composer behavior from Cycle 69 is unchanged after shared-component
    extraction.
  - Result cards continue to use the cycle-68 `ResultCard`.
  - New CSS uses semantic tokens only and all new controls are 44px+.
  - No Watcher Composer mode, record/diary Composer mode, backend route, shared
    API contract, DB schema, migration, LLM prompt, external integration, or
    Today card-priority behavior is changed.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
- Test cases:
  - Today quiet state renders compact Composer modes/input/submit.
  - Today live state renders compact Composer while existing cards and `+ 추가`
    still render.
  - The old Today quick-capture form/test labels are gone or intentionally
    remapped to the shared Composer labels.
  - Switching compact Composer modes updates selected/pressed state and does not
    submit.
  - Empty compact Composer text leaves submit disabled or performs no request.
  - `일정` submit posts only to `/api/capture/flat-event`, includes `{ text, now
    }`, refreshes Today on success, and shows scheduled/raw result feedback.
  - `스레드` submit posts only to `/api/threads/draft`, shows counts/warnings,
    and links to `/threads/:id`.
  - `할 일` submit posts only to `/api/tasks` with `{ title }`, refreshes Today,
    and shows a `할 일` result card.
  - API failure in each compact Composer mode preserves text/mode and shows a
    scoped error.
  - Existing Today manual intake task/event tests still pass.
  - Existing InputHub Composer tests still pass after shared-component
    extraction.
  - Static negative checks:
    - No backend/shared/DB changes:
      `git diff --name-only master...HEAD | rg '^(server|shared)/|^server/drizzle/'`
      should have no matches.
    - No Watcher/record/backend/LLM/schema scope:
      `git diff -U0 master...HEAD -- web/src docs | rg -n '/api/watchers|/api/annotations|/api/mirror|standalone diary|record mode|Watcher mode|completeChat|LLM_PROXY_BASE_URL|CREATE TABLE|ALTER TABLE'`
      should have no implementation matches outside roadmap/plan text.
    - Today card priority stays unchanged:
      `git diff -U0 master...HEAD -- web/src/Today.tsx | rg -n 'priority|cards\\.map|surface\\.cards|case \"conflict\"|case \"watcher\"|case \"next_event\"|case \"two_minute_task\"|case \"needs_review\"|case \"schedule_prompt\"|case \"task_schedule_prompt\"'`
      should show no semantic reordering.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Thread draft can fail because the LLM gateway is unavailable. Today must keep
  deterministic cards usable and show only a scoped Composer error.
- A raw/unscheduled event created from Today may not immediately have a visible
  Today card. The result card must tell the user where to schedule it instead
  of implying that Today lost the object.
- Extracting a shared Composer component can accidentally move API calls into a
  presentational component or break `/input` labels/tests. Keep network work in
  page components and preserve Cycle 69 behavior.

## Simpler Alternative

Only restyle Today's existing event-only quick capture and call it Composer.

Rejected because the roadmap specifically says Today should use the shared
compact Composer entry. Restyling would leave Today as an event-only capture
surface and would not reduce duplicate creation decisions across `/input` and
Today.

## Assumptions

- Cycle 69 is merged into `master`, so the `/input` Composer behavior and
  `ResultCard` reuse are available.
- Today compact Composer uses the same three core modes as Cycle 69. Watcher and
  record modes wait for Cycle 71.
- The existing manual intake sheet remains as the detailed event/task path; this
  cycle only replaces the event-only quick capture form.
- A title-only task is acceptable for compact Today task creation in this
  A-slice; due date, estimate, and thread remain in manual intake or `/input`
  advanced input.
- For unscheduled/raw event results from Today, linking to `/input` is the
  explicit scheduling path unless the implementation can safely surface an
  existing Today schedule prompt after refresh.

## Review Guidance

### Enumeration Required

- Today compact Composer and old quick capture removal:
  - Search:
    `rg -n "CreationComposer|composer|quick capture|today-capture|handleCapture|flatCapture|capture/flat-event|threads/draft|ResultCard|today-add-btn" web/src/Today.tsx web/src/Today.test.tsx web/src/styles.css`
  - Expected: compact Composer path replaces old quick-capture UI; `+ 추가`
    manual intake remains; ResultCard reuse.
- Shared Composer boundary:
  - Search:
    `rg -n "fetch\\(|apiJson|/api/" web/src/CreationComposer.tsx`
  - Expected: no matches. The shared component must be presentational.
- `/input` preservation:
  - Search:
    `rg -n "CreationComposer|composer|고급 입력|threads/draft|capture-result|thread-draft-success|task-result" web/src/InputHub.tsx web/src/InputHub.test.tsx`
  - Expected: Cycle 69 modes, advanced input, and result-card behavior still
    present.
- Future-roadmap leakage:
  - Search:
    `git diff -U0 master...HEAD -- web/src docs | rg -n "Cycle 71|Watcher mode|record mode|standalone diary|/api/watchers|/api/annotations|/api/mirror"`
  - Expected: matches only in roadmap/plan text, not implementation code.

### Verification Method Guide

- Compact Composer rendering/routing/result behavior is frontend-only.
  Component tests are sufficient.
- Today queue preservation should be verified by existing Today tests plus
  targeted tests proving the card stack/manual intake affordances still render.
- Shared Composer purity is best verified by code inspection plus the static
  `rg` no-network check above.
- No backend integration test is required unless implementation changes an API
  contract, which this plan forbids.
- `corepack pnpm test:integration` and `corepack pnpm verify` still run as
  safety checks because Today is the highest-use surface.
