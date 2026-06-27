# Creation Result Cards A Implementation Plan

Branch: feature/cycle-68-creation-result-cards-a
Cycle: 68
Created: 2026-06-28
Skills: frontend-react-pwa

## Summary

Cycle 67 closed the first domain-filter slice. The next UX problem is not a new
backend capability: users can create events, unscheduled events, tasks, thread
drafts, and watchers, but each surface reports success differently.

This cycle implements a bounded frontend A-slice: unify creation result cards
on the existing creation surfaces so the user can immediately see what was
created, where it lives, and the next useful action. It does not restructure
Composer, Today, watcher creation, or backend routes.

Roadmap context lives in
`docs/composer-roadmap-cycles-68-71.md`. That document is not a license to
implement cycles 69-71 in this cycle.

## Input/Output Spec

- Input:
  - Existing successful create responses already used by these surfaces:
    - `/input` quick capture (`POST /api/capture/flat-event`);
    - `/input` manual event create (`POST /api/events`);
    - `/input` manual task create (`POST /api/tasks`);
    - `/threads/new` natural-language thread draft
      (`POST /api/threads/draft`);
    - `/watch` watcher create actions (`POST /api/watchers`,
      `POST /api/watchers/reverse-plan`,
      `POST /api/watchers/manual-exogenous`).
- Normal output:
  - Covered successful creation actions render a consistent result card with:
    - object kind: `일정`, `미정 일정`, `할 일`, `스레드 초안`, or `Watcher`;
    - title or label;
    - status line;
    - primary action;
    - secondary explanation.
  - Primary actions:
    - unscheduled event: `날짜 잡기`;
    - scheduled event/task: `Today에서 보기` or the nearest existing refresh/view
      affordance if no dedicated object route exists;
    - thread draft: `스레드 열기`;
    - watcher: `지켜볼 것에서 보기`.
  - Result cards are accessible success feedback (`role="status"` or
    equivalent), use semantic tokens, and keep 44px touch targets.
- Failure behavior:
  - Existing local error states remain unchanged.
  - Existing forms and APIs continue to work.
  - No backend, DB migration, LLM behavior, Today quick capture refactor,
    Composer mode redesign, watcher/record Composer mode, or route contract
    change is introduced.

## Key Changes

- Frontend:
  - Add or reuse a small presentational result-card component for creation
    success feedback.
  - Update `/input` quick capture success feedback to use the result-card shape.
  - Update `/input` manual event/task success feedback to use the same shape.
  - Update `/threads/new` thread draft success feedback to use the same shape
    while preserving the existing link to `/threads/:id`.
  - Update `/watch` watcher create success feedback to use the same shape and
    point to `/watch`.
  - Add semantic-token CSS for the result card, primary action, and secondary
    text.
- Docs:
  - Keep `docs/composer-roadmap-cycles-68-71.md` as roadmap context only.
  - Update `docs/codebase-map.md` only if the implementation adds a reusable
    component or changes documented UI behavior enough that future agents need
    the navigation hint.

## Sprint Contract

- Passing criteria:
  - `/input` quick capture scheduled success shows an `일정` result card.
  - `/input` quick capture unscheduled/raw success shows a `미정 일정` result
    card and a clear next action for scheduling.
  - `/input` manual event success shows an `일정` result card.
  - `/input` manual task success shows a `할 일` result card.
  - `/threads/new` natural-language draft success shows a `스레드 초안` result
    card and preserves navigation to the created thread.
  - `/watch` date-threshold, reverse-plan, and manual-exogenous watcher create
    success show a `Watcher` result card or a shared result-card wrapper for
    the existing success state.
  - Result-card primary actions are at least 44px tall and keyboard-focusable.
  - Result cards use semantic CSS tokens only.
  - Existing error states remain local and still render.
  - No backend route, shared API contract, DB schema, migration, LLM prompt, or
    Today quick capture behavior is changed.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm build`
  - `git diff --check master...HEAD`
- Test cases:
  - Frontend unit tests for the result-card component or repeated result-card
    rendering on each target surface.
  - `/input` tests cover scheduled capture, unscheduled capture, manual event
    success, and manual task success.
  - `/threads/new` tests cover draft success with the created-thread link.
  - `/watch` tests cover watcher create success feedback for each create mode
    or the shared post-create state used by all modes.
  - Static negative check:
    `git diff -U0 master...HEAD -- server/src shared/src web/src docs | rg -n 'drizzle|CREATE TABLE|ALTER TABLE|completeChat|LLM_PROXY_BASE_URL|/api/today|watcher.*crawler|standalone diary'`
    should have no implementation matches outside docs explaining exclusions.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Quick capture can return `raw_stored` when parsing fails. For this cycle it
  should be displayed as a `미정 일정` result because it is stored as an
  unscheduled Cairn event.
- Some created objects do not have dedicated detail routes. The primary action
  should use the nearest existing safe navigation/refresh action rather than
  inventing a new route.
- Watcher creation modes may already close a sheet and refetch the list. The
  result card must not remove that refetch or make the list stale.

## Simpler Alternative

Only rename existing success text. This is faster, but it does not give the
user a consistent "created object / location / next action" pattern and does
not create a reusable base for the Composer cycles that follow.

## Assumptions

- Cycle 67 is merged into `master`.
- Existing dirty agent/config changes are unrelated and must not be reverted.
- The implementation branch will be `feature/cycle-68-creation-result-cards-a`.
- Cycle 69-71 roadmap sections are not in scope.
- Result-card copy can be Korean because the affected UI is Korean-first.

## Review Guidance

### Enumeration Required

Reviewer must enumerate all target creation surfaces:

- Search:
  - `rg -n "captureStatus|POST /api/capture|handleCapture|handleFormSubmit" web/src/InputHub.tsx`
  - `rg -n "threads/draft|thread-draft|draft-open-link" web/src/ThreadNew.tsx`
  - `rg -n "watchers/reverse-plan|manual-exogenous|createSubmitting|openCreate" web/src/Watchers.tsx`
- Expected targets:
  - `/input` quick capture;
  - `/input` manual event;
  - `/input` manual task;
  - `/threads/new` draft;
  - `/watch` watcher create.

### Verification Guide

- Result-card rendering is frontend behavior. Unit/component tests are
  sufficient for DOM output, action labels, accessibility attributes, and error
  preservation.
- No backend integration test is required unless the implementation changes an
  API contract, which this plan forbids.
- Visual/manual check should inspect mobile width for text fit and 44px action
  targets.

