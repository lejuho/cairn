# Composer Core A Implementation Plan

Branch: feature/cycle-69-composer-core-a
Cycle: 69
Created: 2026-06-28
Skills: frontend-react-pwa

## Summary

Cycle 68 added shared creation result cards across the existing creation
surfaces. The next roadmap item is **Cycle 69: Composer Core A** from
`docs/composer-roadmap-cycles-68-71.md`.

This cycle makes `/input` primarily a Composer screen. The user chooses one of
three explicit modes — `일정`, `스레드`, or `할 일` — types into one central
natural-language input, and receives the cycle-68 `ResultCard` feedback after a
successful creation. Existing manual event/task forms remain available behind
`고급 입력`. This cycle does not touch Today, Watcher/record modes, backend
routes, shared schemas, DB migrations, or API contracts.

## Input/Output Spec

- Input:
  - Existing `/input` screen data loads remain unchanged:
    - `GET /api/today?domain=...`;
    - `GET /api/threads`;
    - best-effort people load for the existing advanced event form.
  - New primary Composer UI:
    - mode segmented control: `일정 | 스레드 | 할 일`;
    - one central text input/textarea;
    - one submit button.
  - Mode-to-existing-API mapping:
    - `일정`: submit text to existing `POST /api/capture/flat-event` with
      `{ text, now }`.
    - `스레드`: submit text to existing `POST /api/threads/draft` with
      `{ text }`.
    - `할 일`: submit text as the title to existing `POST /api/tasks` with
      `{ title }` only in this A-slice.
- Normal output:
  - `일정` success reuses cycle-68 capture result-card behavior:
    - scheduled capture → `일정`, `Today에서 보기`;
    - raw/unscheduled capture → `미정 일정`, `날짜 잡기`.
  - `스레드` success renders a `스레드 초안` result card with:
    - created thread name;
    - counts for events/tasks/links;
    - warnings, if any;
    - primary action `스레드 열기` linking to `/threads/:id`.
  - `할 일` success renders a `할 일` result card with primary action
    `Today에서 보기`.
  - The Composer input clears on successful submit and remains on the selected
    mode.
  - Existing unscheduled-event list and scheduling actions on `/input` remain
    available.
  - Existing manual event/task forms remain available only after opening
    `고급 입력`, and their current behavior/result cards are preserved.
- Failure behavior:
  - Empty Composer input is client-side rejected/disabled.
  - Mode-specific API failures show a local Composer error and preserve typed
    text and selected mode.
  - Advanced manual-form errors remain local and unchanged.
  - No hidden auto-routing: the selected mode determines the endpoint.
  - No backend route, shared API contract, DB schema, migration, LLM prompt,
    Today quick capture adoption, watcher Composer mode, record/diary mode, or
    route redesign is introduced.

## Key Changes

- Frontend:
  - `web/src/InputHub.tsx`
    - Add primary Composer state: selected mode, text, submitting/error/result.
    - Render a top Composer block in quiet and live states.
    - Route submits to the existing capture, thread-draft, or task endpoint
      based only on selected mode.
    - Reuse `ResultCard` for all Composer success states.
    - Move the existing manual event/task form block behind a collapsed
      `고급 입력` affordance by default.
    - Preserve unscheduled events, slot candidate loading, schedule apply,
      domain filter, access/error/loading/quiet/live behavior.
  - `web/src/InputHub.test.tsx`
    - Add Composer mode/submit/result/error tests.
    - Preserve tests for advanced manual event/task forms.
  - `web/src/styles.css`
    - Add semantic-token styles for the Composer block, mode segments, central
      input, submit action, and advanced toggle with 44px targets.
  - Optional extraction only if useful:
    - A small presentational `ComposerBox` component may be added inside
      `web/src` if it keeps `InputHub.tsx` readable. It must be data-in,
      callbacks-out, and contain no API calls.
- Docs:
  - `docs/composer-roadmap-cycles-68-71.md`
    - Mark cycle 69 as promoted; keep cycles 70-71 as roadmap only.
  - `docs/codebase-map.md`
    - Update only if the implementation adds a reusable Composer component or
      materially changes the `/input` navigation hint.

## Sprint Contract

- Passing criteria:
  - `/input` renders one primary Composer block in quiet and live states.
  - Composer has exactly three modes in this cycle: `일정`, `스레드`, `할 일`.
  - Mode selection is explicit, visible, keyboard-focusable, and 44px+.
  - The selected mode alone determines the endpoint; there is no hidden
    classifier or auto-routing.
  - Empty Composer text cannot submit.
  - `일정` mode calls `POST /api/capture/flat-event` and preserves scheduled vs
    unscheduled/raw result-card behavior from cycle 68.
  - `스레드` mode calls `POST /api/threads/draft` and renders a `스레드 초안`
    result card with `/threads/:id` navigation, counts, and warnings.
  - `할 일` mode calls `POST /api/tasks` with `{ title }` only and renders a
    `할 일` result card.
  - Composer submit failure keeps the selected mode and typed text and renders a
    local `role="alert"` error.
  - Existing manual event/task forms are collapsed behind `고급 입력` by default.
  - Opening `고급 입력` restores the existing manual event/task UI and behavior.
  - Existing unscheduled events list, slot candidate preview, schedule apply,
    domain filtering, loading, quiet, live, error, and access-session states
    remain available.
  - Result cards continue to use the cycle-68 `ResultCard`.
  - New CSS uses semantic tokens only and all new controls are 44px+.
  - No `/today` UI, Watcher Composer mode, record/diary Composer mode, backend
    route, shared API contract, DB schema, migration, LLM prompt, or external
    behavior is changed.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
- Test cases:
  - Composer renders in quiet and live `/input` states.
  - Switching modes updates selected/pressed state and placeholder/copy without
    submitting.
  - Empty Composer text leaves submit disabled or performs no request.
  - `일정` submit posts only to `/api/capture/flat-event` and shows the correct
    result card for scheduled and raw/unscheduled responses.
  - `스레드` submit posts only to `/api/threads/draft`, shows counts/warnings,
    and links to `/threads/:id`.
  - `할 일` submit posts only to `/api/tasks` with `{ title }` and shows a
    `할 일` result card.
  - API failure in each Composer mode preserves text/mode and shows local error.
  - `고급 입력` is collapsed by default and opens the existing manual event/task
    forms.
  - Existing manual event/task success and error tests still pass behind
    advanced input.
  - Static negative checks:
    - No backend/shared/DB changes:
      `git diff --name-only master...HEAD | rg '^(server|shared)/|^server/drizzle/'`
      should have no matches.
    - No Today adoption, watcher/record mode, or external/LLM scope:
      `git diff -U0 master...HEAD -- web/src docs | rg -n 'POST /api/watchers|/api/watchers|/api/annotations|/api/mirror|standalone diary|record mode|Today quick capture|completeChat|LLM_PROXY_BASE_URL|CREATE TABLE|ALTER TABLE'`
      should have no implementation matches outside roadmap/plan text.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- A user may type task-like text while `일정` is selected. This A-slice should
  not infer or reroute; explicit mode wins.
- Thread draft can return warnings even on success. The result card must keep
  those warnings visible so "unknown fields" are not hidden.
- Collapsing manual forms can accidentally hide the only path for detailed event
  fields such as start/end/person/mode. The `고급 입력` affordance must be
  visible and reversible in quiet and live states.

## Simpler Alternative

Rename the existing quick capture section to "Composer" and leave manual forms
visible.

Rejected because the roadmap specifically moves `/input` toward one central
mode-selected Composer. A rename would keep the fragmented decision surface and
would not prepare the Today Composer adoption slice.

## Assumptions

- Cycle 68 is merged into `master`, so `ResultCard` is available.
- The untracked local roadmap file is now promoted into versioned docs as part
  of this cycle prep because the user explicitly asked to follow it.
- Task Composer mode creates a simple title-only task in this A-slice; due date,
  estimate, thread, and optional flags remain in `고급 입력`.
- Thread Composer mode uses the existing LLM-backed thread draft endpoint but
  does not change backend prompt/schema behavior.
- Today quick capture adoption is cycle 70 and must not be implemented here.

## Review Guidance

### Enumeration Required

- `/input` Composer and advanced-input surfaces:
  - Search:
    `rg -n "Composer|composer|고급 입력|advanced|handleComposer|handleCapture|threads/draft|ResultCard|form.mode" web/src/InputHub.tsx web/src/InputHub.test.tsx web/src/styles.css`
  - Expected: one primary Composer path, existing manual paths behind advanced
    input, and ResultCard reuse.
- Endpoint routing in `/input`:
  - Search:
    `git diff -U0 master...HEAD -- web/src/InputHub.tsx | rg -n "/api/(capture/flat-event|threads/draft|tasks|events|watchers|annotations|mirror|today)"`
  - Expected: new Composer writes only to capture, thread draft, or tasks.
    Existing advanced/manual event paths may still call `/api/events`. No
    watcher/annotation/mirror writes.
- Future-roadmap leakage:
  - Search:
    `git diff -U0 master...HEAD -- web/src docs | rg -n "Cycle 70|Cycle 71|Watcher mode|record mode|Today quick capture|standalone diary"`
  - Expected: matches only in roadmap/plan text, not implementation code.

### Verification Method Guide

- Composer rendering/routing/result behavior is frontend-only. Component tests
  are sufficient.
- Manual event/task preservation should be verified by existing InputHub tests
  plus at least one new test proving advanced input opens the forms.
- No backend integration test is required unless implementation changes an API
  contract, which this plan forbids.
- `corepack pnpm test:integration` and `corepack pnpm verify` still run as
  safety checks because the cycle touches a high-use creation surface.
