# Task Slot Evidence Actions A Implementation Plan

Branch: feature/cycle-64-task-slot-evidence-actions
Cycle: 64
Created: 2026-06-27
Skills: frontend-react-pwa

## Summary

Remaining implementation specs after cycle 63:

- The core `FR-SLOT` flow is now usable end-to-end for both unscheduled events
  and due-imminent tasks: identify, preview candidates, dismiss Today prompts,
  and apply a selected task candidate into one scheduled Cairn block event.
- `FR-SLOT-08` contribution decomposition exists in the shared slot candidate
  contract and is rendered in Today for both event and task candidates.
- The actionable part of `FR-SLOT-09` exists for event candidates only:
  non-neutral feasibility evidence opens the feasibility settings sheet,
  friction evidence links to Mirror, and single-person people evidence links to
  the person profile. Task candidates currently render the same contribution
  evidence as inert text even though they use the same shared `SlotCandidate`
  shape.
- Gmail parse fallback remains policy-undecided. Movement, GCal mirror,
  watcher-B automation, and Typst/pcli export are external-heavy or later-phase
  work. They are not the next safest slice.

Recommended next spec: **FR-SLOT-09B Task Slot Evidence Actions A**.

This cycle gives due-task slot candidates the same lightweight evidence action
affordances already present on event slot candidates, without adding backend
routes, storage, new scoring, automatic scheduling, or new external calls. The
result is parity: a task candidate reason can point to the relevant adjustment
surface, while the actual schedule-block apply remains an explicit separate
tap.

## Input/Output Spec

- Input:
  - Today task schedule prompt cards (`task_schedule_prompt`) after candidate
    loading via `GET /api/tasks/:id/slot-candidates`.
  - Existing `SlotCandidate.contributions[]` values:
    - `lens='feasibility'`
    - `lens='friction'`
    - `lens='people'`
    - `impact` positive/neutral/negative
    - optional `personIds`
- Normal output:
  - Task candidate contribution rows still show the first evidence string or
    contribution label.
  - For non-neutral task feasibility contributions, render a scoped `조정`
    action that opens the existing feasibility settings sheet using the current
    Today surface params.
  - For non-neutral task friction contributions, render a `패턴` link to
    `/mirror`.
  - For non-neutral task people contributions with exactly one `personIds`
    value, render a `프로필` link to `/people/:id`.
  - Neutral contributions and people contributions with zero or multiple
    person ids remain text-only.
  - These actions do not schedule or apply a task block. Applying still requires
    tapping the candidate button itself.
- Failure/no-op behavior:
  - Feasibility settings fetch failure uses the existing scoped feasibility
    sheet error path.
  - Evidence action taps do not hide the task prompt, do not clear task slot
    state, and do not call task schedule-block endpoints.
  - No backend, shared schema, DB, route, LLM, Gmail, GCal, movement, cron, or
    Mirror API behavior changes.

## Key Changes

- Frontend:
  - `web/src/Today.tsx`
    - Extract or otherwise share the existing slot contribution reason action
      rendering between event candidates and task candidates.
    - Add task candidate reason actions matching event candidate semantics:
      feasibility -> existing feasibility settings sheet, friction -> `/mirror`,
      single-person people -> `/people/:id`.
    - Keep candidate apply button behavior unchanged and separate from reason
      action clicks.
  - `web/src/Today.test.tsx`
    - Add task slot evidence action tests for feasibility, friction, and people.
    - Assert evidence actions do not call `/api/tasks/:id/schedule-block`.
    - Preserve existing event slot evidence action tests and cycle-63 apply
      tests.
  - `web/src/styles.css`
    - Reuse semantic-token styling for `.today-slot-reason-link`.
    - If the implementation changes action hit areas, keep touch targets at
      least 44px and avoid text overflow on mobile.
- Docs:
  - `docs/codebase-map.md`
    - Record that task slot candidate reason rows now share the event candidate
      evidence action behavior.

## Sprint Contract

- Passing criteria:
  - Task slot candidate feasibility evidence has a keyboard-focusable `조정`
    action for non-neutral contributions.
  - Clicking task feasibility `조정` opens the existing feasibility settings
    sheet and fetches `/api/feasibility/params`; it does not call
    `/api/tasks/:id/schedule-block`.
  - Task slot candidate friction evidence has a `/mirror` link for non-neutral
    contributions.
  - Task slot candidate people evidence has a `/people/:id` link only when the
    contribution has exactly one `personIds` entry.
  - Neutral task contributions remain text-only.
  - Event slot evidence actions remain unchanged.
  - Task candidate apply behavior remains unchanged: clicking the candidate
    button still posts `POST /api/tasks/:id/schedule-block` with captured
    `date/now/days/start/end` and refreshes on success.
  - No new route, shared schema, DB migration, repository, service, LLM, Gmail,
    GCal, movement, Mirror API, cron, notification draft, or status mutation is
    introduced.
  - UI remains mobile-first, semantic-token based, keyboard focusable, and all
    newly introduced controls have at least 44px touch targets.
  - `docs/codebase-map.md` reflects the new frontend boundary.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
- Test cases:
  - Frontend:
    - Existing event feasibility/friction/people reason action tests still pass.
    - Task feasibility reason action opens feasibility settings and fetches
      `/api/feasibility/params`.
    - Task friction reason action points to `/mirror`.
    - Task people reason action points to `/people/:id` when there is one
      `personIds` entry.
    - Task people reason with multiple ids has no profile link.
    - Neutral task contribution has no reason action.
    - Task reason action click does not call `/api/tasks/:id/schedule-block`
      or event schedule endpoints.
    - Existing task apply success/failure tests still pass.
  - Static negative checks:
    - No backend/shared/db changes:
      `git diff --name-only master...HEAD | rg '^(server|shared)/'`
      should have no matches.
    - No external/LLM/GCal/Gmail/movement/cron:
      `git diff -U0 master...HEAD -- web/src docs | rg -n 'completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|mirror/[^"]|movement|scheduler|cron'`
      should have no implementation matches except the existing `/mirror`
      frontend link/copy.
    - No accidental scheduling from reason actions:
      inspect tests and `Today.tsx` handlers; only candidate apply may call
      `/api/tasks/:id/schedule-block`.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- A people contribution can contain multiple candidate people. This A-slice
  must not guess which profile to open; leave it text-only.
- A reason action sits inside a candidate row whose neighboring button applies
  the schedule block. Event propagation must not accidentally trigger apply.
- Enlarging the reason action hit area could crowd mobile rows or wrap long
  evidence text poorly; tests should assert controls exist, and implementation
  should use flex wrapping or stable row dimensions where needed.

## Simpler Alternative

Copy the event contribution JSX into the task candidate block.

Rejected because it duplicates branchy link/button behavior in a dense Today
surface. A small local helper in `Today.tsx` keeps event and task candidate
reason actions equivalent and makes future `FR-SLOT-09` slices safer.

## Assumptions

- `SlotSuggestionContribution.personIds` is already part of the shared schema
  and does not need a contract change.
- `/mirror`, `/people/:id`, and the feasibility settings sheet are the current
  adjustment surfaces for friction, people, and feasibility respectively.
- Task candidates can reuse the exact event candidate action semantics because
  both are generated by the same slot candidate service and shared schema.
- This cycle does not implement source-evidence expansion beyond the evidence
  text already displayed in the row.

## Review Guidance

### Enumeration Required

- Compare event and task candidate reason rendering in `web/src/Today.tsx`:
  - Search: `rg -n "today-slot-reason|today-slot-reason-link|handleApplyTaskBlock|handleSchedule" web/src/Today.tsx`
  - Expected: event and task candidate contribution rows use the same reason
    action behavior; task apply and event schedule handlers remain separate.
- Enumerate task slot evidence tests:
  - Search: `rg -n "task.*reason|task.*feas|task.*friction|task.*people|schedule-block" web/src/Today.test.tsx`
  - Expected: tests cover feasibility, friction, single-person, multi-person,
    neutral, and no schedule-block side effect.

### Verification Method Guide

- Frontend reason-action behavior:
  - Vitest DOM tests are sufficient because this is client rendering and click
    routing inside `Today.tsx`.
- No backend/shared/db changes:
  - Static file enumeration is sufficient. Any server/shared change is outside
    plan scope unless the cycle is explicitly amended.
- No accidental schedule-block call:
  - Unit tests with fetch spy are required; static inspection alone is
    insufficient because click bubbling could be missed.
- Touch target and semantic-token styling:
  - CSS inspection plus existing frontend build/lint are sufficient for this
    A-slice; no visual regression tooling exists yet.
