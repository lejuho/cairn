# Decision People Guard A Implementation Plan

Branch: `feature/cycle-21-decision-people-guard-a`
Cycle: `21`
Created: `2026-06-19`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Cycles 15, 18, and 19 already provide event-person tagging, deterministic
conflict decisions, separated cost chips, advisory suggestions, resolve
mutations, and NOW gating. Cycle 21 connects those surfaces through a narrow
People Guard A:

- derive relationship meeting statistics from linked historical events;
- adjust only the social cost dimension with an explicit frequency breakdown;
- let the user author a deterministic weekday-unavailable hard constraint;
- block a conflict option when keeping the other event would violate a linked
  person's hard constraint.

This is a partial implementation of FR-PPL-02 (meeting count and last met only),
plus FR-PPL-04, FR-PPL-05, FR-DEC-03, and FR-DEC-04. Time-pattern inference is
deferred.

Out of scope:

- Automatic profile or constraint inference.
- Natural-language constraint parsing.
- Preferred-window scoring.
- Person directory/detail route.
- Notification draft generation.
- Person filter/highlight mode.
- Gmail/refund enrichment.
- New LLM use.
- New tables or migrations.

Preparation pass creates only `.review/cycle-21/*` artifacts and stops before
implementation.

## Input/Output Contract

- `GET /api/people`
  - Keep current sorting and fields.
  - Extend each `PersonRow` with normalized `hardConstraints`.
  - Supported A constraint shape:
    - `type: "weekday_unavailable"`.
    - `weekday: monday | tuesday | wednesday | thursday | friday | saturday | sunday`.
    - `text: string` for display.
    - `firmness: "hard"`.
  - Missing, malformed, or unsupported stored JSON produces no enforceable
    constraint. It must never fabricate a block.

- `PUT /api/people/:id/hard-constraints`
  - Path `id`: positive integer; person must exist.
  - Body: `{ "unavailableWeekdays": Weekday[] }`.
  - De-duplicate weekdays and replace the supported weekday constraint set.
  - Persist `people.hard_constraints` as JSON objects containing at least
    `text` and `firmness`, matching the spec's storage contract.
  - Return `{ ok: true, data: { person } }` with normalized constraints.
  - Failures:
    - `400 VALIDATION_ERROR`.
    - `404 NOT_FOUND`.

- `GET /api/decisions/conflicts?date=YYYY-MM-DD&now=<ISO datetime>`
  - Preserve Cycle 18/19 response fields.
  - Extend each `ConflictDecisionOption` with:
    - `socialContext`:
      - `base`: stored `events.cancel_social`, nullable.
      - `adjustment`: sum of known per-person adjustments, nullable when no
        relationship evidence exists.
      - `effective`: adjusted social cost used by `cost.social` and internal
        suggestion ordering.
      - `confidence: none | cold_start | derived`.
      - `contributions`: person id/name, `totalMeets`, `lastMet`, frequency
        band, and numeric adjustment.
    - `peopleGuard`:
      - `blocked: boolean`.
      - `keepEventId`: the other event that this option would keep.
      - `reasonCodes: string[]`.
      - `constraints`: blocking person id/name, kept event id, and constraint
        text.
  - Option semantics remain unchanged: `option.event` is the event to move or
    cancel. Therefore the guard evaluates constraints on the other, kept event.
  - A hard constraint on event A blocks "change B / keep A". It does not block
    changing A away from the violating time.

- Deterministic relationship statistics:
  - Query from `event_people` joined to scheduled events for each affected
    person.
  - Count only events ending before `now` with status `done` or `confirmed`.
  - Exclude `planned`, `cancelled`, `moved`, and `late` rows from evidence.
  - `totalMeets` is qualifying event count; `lastMet` is latest qualifying end.
  - Derive at read time in Cycle 21. Do not mutate cache columns during GET.
  - Frequency defaults:
    - `0`: `cold_start`, no inferred adjustment.
    - `1..2`: `rare`, `+2` social contribution.
    - `3..7`: `established`, `+1`.
    - `8+`: `frequent`, `+0`.
  - Multiple linked people contribute separately and visibly. Sum only within
    the social dimension; never expose a money/social/effort scalar total.
  - When no people evidence exists, preserve current stored social cost and
    suggestion behavior.

- Deterministic weekday guard:
  - Match weekday against the literal `YYYY-MM-DD` prefix of the kept event's
    stored `start`; do not normalize it into server timezone first.
  - Only supported constraints with `firmness="hard"` may block.
  - A blocked option is never marked `suggested`.
  - If one option is allowed and one blocked, the allowed option may receive
    `required_by_people_constraint` as an advisory reason; it still requires a
    user tap.
  - If both options are blocked, keep the conflict visible and show escalation
    copy. No mutation happens automatically.

- `POST /api/decisions/conflicts/resolve`
  - Keep current request body and stale/NOW checks.
  - Re-read event people and hard constraints inside the resolve transaction.
  - Check the guard after event existence/status/overlap/NOW validation and
    before event or annotation writes.
  - Reject a blocked option with `409 PEOPLE_CONSTRAINT_BLOCKED`.
  - Rejection performs no status update and no annotation insert.

- Frontend:
  - `/input` existing people checklist adds a compact constraint control for
    each person.
  - Opening it shows a bottom sheet with seven weekday toggles and save action.
  - Save calls `PUT /api/people/:id/hard-constraints`, refreshes people, and
    keeps current event selections intact.
  - Conflict sheet shows social contributions and blocking person/constraint.
  - Disable only the affected option's move/cancel buttons. Existing conflict
    `read_only` still disables all options.
  - Save/resolve failures keep the relevant sheet open with local error copy.

## Key Changes

- Shared:
  - Add weekday, normalized hard-constraint, relationship contribution,
    social-context, and people-guard schemas/types.
  - Extend `PersonRowSchema` and `ConflictDecisionOptionSchema`.
  - Add hard-constraint replace request/response schemas and typed conflict
    error contract as needed.

- Backend:
  - Extend people repository with normalized constraint read/replace helpers.
  - Add a relationship-stat query for people attached to conflict events.
  - Add a pure deterministic people-impact/weekday-guard service.
  - Extend decision assembly and internal suggestion ordering with effective
    social cost and option-level guards.
  - Extend resolve transaction with a fresh guard check.
  - Add `PUT /api/people/:id/hard-constraints` to the existing people route.
  - Keep decision and people code independent from the LLM gateway.

- Frontend:
  - Add weekday constraint editing to `/input` through a mobile bottom sheet.
  - Extend Today conflict sheet with relationship context, hard-constraint
    reasons, option-level disabled actions, and both-blocked escalation copy.
  - Use `apiJson`; preserve Access-session recovery behavior.

- Docs:
  - Update `docs/codebase-map.md` after implementation with the new people
    constraint endpoint, people-impact service, decision guard, and UI paths.

## Sprint Contract

- Passing criteria:
  - Existing people can save and reload weekday-unavailable constraints.
  - Invalid id/body returns typed errors; missing person returns 404.
  - Constraint replacement de-duplicates weekdays.
  - Malformed/unsupported stored JSON never blocks an option.
  - Meeting statistics use qualifying persisted history and deterministic
    `now`, with correct `totalMeets` and `lastMet`.
  - Frequency boundary values 0, 1, 2, 3, 7, and 8 follow the documented bands.
  - Per-person contributions remain visible; no cross-dimension total leaks.
  - `cost.social` and suggestion ordering use effective social cost.
  - No-person/cold-start conflicts preserve existing behavior.
  - Hard weekday constraint blocks only the option that keeps the violating
    event.
  - Soft, malformed, and non-matching constraints do not block.
  - Blocked options are never suggested.
  - Both-blocked conflicts remain visible and require user intervention.
  - Resolve re-checks constraints and rejects stale/blocked choices with no
    partial write.
  - `/input` constraint editor saves without losing selected event people.
  - Today conflict sheet shows social and hard-constraint context.
  - Option-level block disables only affected actions; NOW read-only disables
    all actions.
  - Existing conflict resolve, event detail, feasibility, schedule prompt,
    needs-review, and Access recovery flows remain working.
  - No LLM dependency is added.
  - No migration is added.
  - `docs/codebase-map.md` is updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Backend integration with temporary SQLite:
    - hard-constraint get/replace/dedup/validation/not-found behavior;
    - malformed JSON fail-open behavior;
    - stats count only ended `done`/`confirmed` linked events;
    - future and planned/cancelled/moved/late events are excluded;
    - latest qualifying end becomes `lastMet`;
    - all frequency threshold boundaries and multi-person sum;
    - no-person and cold-start behavior preserve stored social cost;
    - literal-date weekday matching remains stable across ISO offsets;
    - hard match blocks keep-side option; soft/non-match does not;
    - blocked option cannot become suggested;
    - resolve rejects blocked option with no event/annotation write;
    - allowed option still resolves and writes ledger annotation.
  - Frontend:
    - InputHub opens constraint sheet, toggles weekdays, saves, and preserves
      event person selection;
    - save failure keeps sheet open with error;
    - conflict sheet renders people contributions and constraint reason;
    - blocked option buttons are disabled and make no resolve request;
    - unblocked option remains actionable;
    - both-blocked copy appears;
    - existing planning `read_only`, successful resolve, failed resolve, and
      Access-session states remain covered.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- The same person is attached to both conflicting events. Compute each event's
  impact independently and never duplicate a person within one option.
- User opens the sheet, then constraints or event-person links change before
  resolve. Transactional re-check must reject the stale choice without writes.
- Event ISO datetime offset crosses UTC midnight. Weekday matching must use the
  stored literal calendar date, not host/UTC-converted weekday.

## One Simpler Alternative

Use cached `people.total_meets` directly and disable options only in the web UI.
This is faster, but cached values currently have no refresh owner and frontend
blocking cannot protect the mutation route. Query-time derivation plus server
transaction re-check is required for correct deterministic behavior.

## Assumptions

- Existing `people.hard_constraints`, `people.total_meets`, and
  `people.last_met` columns are present; no migration is needed.
- Cycle 21 intentionally derives meeting stats at read time and leaves cache
  refresh ownership for a later People profile cycle.
- `done` and past `confirmed` events are sufficient A-level evidence of a
  meeting; `planned` is not treated as observed fact.
- Weekday-unavailable is the only machine-enforceable hard constraint in A.
- Unsupported free-text constraints remain unknown rather than being parsed or
  enforced heuristically.
- Suggestions remain advisory and never mutate decisions automatically.
- Single-user writes use last-write-wins for full constraint replacement.

## Review Guidance

### Enumeration Required

- People constraint contract and persistence:
  - Search: `rg -n "HardConstraint|weekday_unavailable|hardConstraints|hard_constraints|unavailableWeekdays" shared/src server/src web/src docs/codebase-map.md`
  - Expected: shared schemas, people repository/route, InputHub editor, tests,
    and map entries.

- Relationship statistics and social adjustment:
  - Search: `rg -n "totalMeets|lastMet|frequencyBand|socialContext|adjustment|effective" shared/src server/src web/src`
  - Expected: one deterministic backend owner, shared response contract,
    Today display, and threshold tests.

- Conflict guard boundary:
  - Search: `rg -n "peopleGuard|PEOPLE_CONSTRAINT_BLOCKED|required_by_people_constraint|keepEventId" shared/src server/src web/src`
  - Expected: option assembly, resolve re-check, typed 409, disabled UI, and
    integration/frontend tests.

- Scalar leak:
  - Search: `rg -n "totalCost|costTotal|combinedScore|publicScore" shared/src server/src web/src`
  - Expected: no public cross-dimension scalar. Internal ordering remains
    private to the decision service.

- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src/services server/src/routes/decisions.ts server/src/routes/people.ts web/src`
  - Expected: no new people/decision dependency on LLM.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.

### Verification Guide

- Meeting derivation, option guarding, and resolve no-partial-write behavior
  require real temporary SQLite integration tests. Mock-only backend tests are
  insufficient.
- Pure frequency thresholds and literal-date weekday matching may also have
  focused unit tests, but they do not replace repository/transaction coverage.
- Frontend may use mocked fetch, but must verify exact endpoint/payload,
  disabled actions produce no request, successful save/resolve refreshes data,
  and errors preserve the open sheet.
- Reviewer must treat profile inference, arbitrary-text parsing, notifications,
  Gmail enrichment, preferred windows, and migrations as scope creep.
