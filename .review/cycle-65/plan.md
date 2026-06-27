# Slot Evidence Details A Implementation Plan

Branch: feature/cycle-65-slot-evidence-details
Cycle: 65
Created: 2026-06-27
Skills: frontend-react-pwa

## Summary

Remaining implementation specs after cycle 64:

- `FR-SLOT-01` through `FR-SLOT-07` are covered for the current A-slices:
  unscheduled Cairn events and due-imminent tasks can surface in Today, load
  candidates, dismiss prompts, and explicitly schedule/apply a chosen candidate.
- `FR-SLOT-08` contribution decomposition exists in the shared
  `SlotCandidate.contributions[]` contract and renders in Today for both event
  and task candidates.
- `FR-SLOT-09` adjustment links now exist for both event and task candidates:
  feasibility -> settings, friction -> Mirror, single-person people evidence ->
  person profile.
- The remaining lightweight `FR-SLOT-09` gap is the "source evidence unfold"
  part: Today still shows only `contrib.evidence[0]` per lens. The server often
  sends more existing evidence strings (for example feasibility can include
  energy plus gap/continuous notes; friction can include weekday/type/thread
  sample statements), but the UI hides them.
- Gmail parse fallback remains policy-undecided. Movement, GCal mirror,
  watcher-B automation, raw friction drilldown APIs, and Typst/pcli export are
  external-heavy or later-phase work.

Recommended next spec: **FR-SLOT-09C Slot Evidence Details A**.

This cycle adds a tap-to-expand evidence detail affordance to the shared slot
reason renderer. It uses only the existing `contributions[].evidence[]` payload,
so it remains frontend-only and deterministic. It does not add raw annotation
fetches, new Mirror APIs, new scoring, automatic scheduling, or persistence.

## Input/Output Spec

- Input:
  - Existing Today event and task slot candidate rows.
  - Existing `SlotSuggestionContribution` values:
    - `lens`
    - `impact`
    - `label`
    - `evidence: string[]`
    - `personIds?`
- Normal output:
  - The first evidence line remains visible exactly as today.
  - Contributions with more than one non-empty evidence line render a
    keyboard-focusable 44px `근거` toggle.
  - Collapsed state hides secondary evidence lines.
  - Expanded state shows all additional non-empty evidence lines in a compact
    nested list under that contribution.
  - The toggle uses `aria-expanded` and a stable label so screen readers can
    tell whether the details are open.
  - Existing `조정`/`패턴`/`프로필` actions remain available and keep their
    behavior.
  - Event and task candidates share the same behavior through
    `SlotReasonList`.
- No-op / failure behavior:
  - Contributions with zero or one non-empty evidence line render no detail
    toggle.
  - Detail toggles do not schedule an event, apply a task block, dismiss a
    prompt, navigate, fetch APIs, or clear local slot state.
  - There is no new backend, shared schema, DB migration, route, service, LLM,
    Gmail, GCal, movement, cron, or Mirror API behavior.

## Key Changes

- Frontend:
  - `web/src/Today.tsx`
    - Extend the shared `SlotReasonList` to support per-contribution expanded
      evidence state.
    - Render a 44px `근거` toggle only when a contribution has secondary
      evidence lines.
    - Render secondary evidence as descriptive text, not recommendations or
      scores.
    - Keep the existing reason action links/buttons and candidate apply buttons
      separate.
  - `web/src/Today.test.tsx`
    - Add event-candidate evidence detail tests.
    - Add task-candidate evidence detail tests.
    - Assert no detail toggle for single/empty evidence.
    - Assert toggling evidence does not call event schedule, task schedule-block,
      dismiss, or any new API.
    - Preserve cycle-64 action tests.
  - `web/src/styles.css`
    - Add semantic-token styling for the expanded evidence list and the `근거`
      toggle.
    - Keep all new controls at least 44px and mobile wrapping safe.
- Docs:
  - `docs/codebase-map.md`
    - Record that slot reason rows can expand existing evidence lines, without
      extra fetches or backend contracts.

## Sprint Contract

- Passing criteria:
  - Event slot candidate contributions with multiple evidence lines expose a
    44px, keyboard-focusable `근거` toggle.
  - Task slot candidate contributions with multiple evidence lines expose the
    same toggle through the shared renderer.
  - Toggling expands/collapses only secondary evidence lines; the first evidence
    line remains visible in both states.
  - Contributions with one or zero non-empty evidence lines render no detail
    toggle.
  - Existing feasibility/friction/people action behavior remains unchanged.
  - Detail toggles never trigger candidate apply/schedule, prompt dismiss, route
    navigation, or any network fetch.
  - No backend/shared/db migration/route/service change is introduced.
  - No raw annotation drilldown, Mirror data fetch, new scoring, external API,
    LLM call, Gmail/GCal/movement/cron behavior, notification draft, or status
    mutation is introduced.
  - UI remains mobile-first, semantic-token based, keyboard focusable, and all
    new controls are at least 44px touch targets.
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
    - Event candidate with three evidence lines starts collapsed, shows first
      line, and expands to show the two secondary lines.
    - Task candidate with multiple evidence lines behaves the same.
    - Clicking the `근거` toggle twice collapses the details again and updates
      `aria-expanded`.
    - Single-evidence and empty-evidence contributions render no `근거` toggle.
    - Evidence toggle click does not call `/api/events/:id/schedule`,
      `/api/tasks/:id/schedule-block`, dismiss endpoints, or any extra fetch.
    - Existing event/task `조정`/`패턴`/`프로필` tests still pass.
    - Existing task apply success/failure tests still pass.
  - Static negative checks:
    - No backend/shared/db changes:
      `git diff --name-only master...HEAD | rg '^(server|shared)/'`
      should have no matches.
    - No new external/LLM/GCal/Gmail/movement/cron/Mirror fetch:
      `git diff -U0 master...HEAD -- web/src docs | rg -n 'completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|fetch\\([^)]*mirror|/api/mirror|movement|scheduler|cron'`
      should have no implementation matches.
    - No accidental scheduling from evidence toggles:
      inspect tests and `Today.tsx`; only candidate buttons may call schedule
      or schedule-block endpoints.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Evidence arrays may contain empty strings or whitespace. The renderer should
  ignore blank secondary lines and avoid showing an empty details list.
- Multiple candidates can contain the same lens. Expansion state must be scoped
  enough that toggling one reason does not unexpectedly expand unrelated
  candidate rows.
- The row already contains action controls (`조정`/`패턴`/`프로필`). The detail
  toggle must not crowd mobile rows or reduce touch targets below 44px.

## Simpler Alternative

Always render every evidence line under each contribution.

Rejected because Today is a 30-second execution surface. Full expansion by
default would make slot cards too tall and bury the apply/dismiss controls. A
tap-to-expand detail keeps the primary recommendation compact while preserving
source visibility on demand.

## Assumptions

- `contributions[].evidence[]` is the current source-evidence payload for this
  A-slice. Raw annotation rows or exact Mirror buckets are not available without
  new backend contracts and are intentionally out of scope.
- The current shared `SlotReasonList` is the correct ownership point because
  both event and task candidates already use it.
- Showing evidence text is descriptive only; it must not introduce advice,
  recommendation scores, or automatic changes.

## Review Guidance

### Enumeration Required

- Enumerate all `SlotReasonList` call sites:
  - Search: `rg -n "SlotReasonList|today-slot-reason|today-slot-evidence" web/src/Today.tsx`
  - Expected: event and task candidate blocks both use the shared renderer; no
    separate task-only evidence rendering exists.
- Enumerate evidence detail tests:
  - Search: `rg -n "evidence detail|근거|aria-expanded|schedule-block|/schedule" web/src/Today.test.tsx`
  - Expected: event, task, collapse, no-toggle, and no-network/schedule cases.

### Verification Method Guide

- UI behavior:
  - Vitest DOM tests are sufficient because the cycle only changes local React
    rendering and click state inside `Today.tsx`.
- Scope:
  - Static file enumeration must prove no server/shared changes.
- No accidental schedule/apply:
  - Fetch-spy tests are required because click propagation and nested controls
    can regress silently.
- Touch target and mobile wrapping:
  - CSS inspection plus frontend tests/build are sufficient for this A-slice;
    no visual regression tooling exists yet.
