# People Profile B — Authored Availability Implementation Plan

Branch: `feature/cycle-23-people-profile-b`
Cycle: `23`
Created: `2026-06-20`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Cycles 21 and 22 established person tagging, deterministic relationship stats,
weekday hard constraints, conflict guards, and the People directory/detail
surface. Cycle 23 adds the first user-authored handling profile without
claiming automatic inference:

- preferred weekdays and day periods;
- minimum notice lead time;
- preferred contact channel;
- unavailable weekday hard constraints;
- a tap-first profile editor on `/people/:id`.

The profile is explicit user input and therefore confirmed. Preferred windows
and lead time are stored as structured JSON in the existing TEXT columns with
`firmness: "hard"`; no migration is required. Channel remains the existing
lowercase enum and is treated as confirmed because this cycle never infers it.

This is a partial delivery of FR-PPL-03. It prepares deterministic inputs for
future slot scoring and notification drafts, but those consumers remain out of
scope.

Out of scope:

- Automatic profile or time-pattern inference.
- Soft profile values or a soft-to-hard confirmation flow.
- Sensitivities collection; no safe structured vocabulary is specified yet.
- Person name/relation editing, merge, deletion, or deduplication.
- Notification draft generation or delivery.
- Slot scoring or preferred-window enforcement.
- Person filtering/highlighting on Today.
- New LLM calls, tables, columns, or migrations.

Preparation pass creates only `.review/cycle-23/*` artifacts and stops before
implementation.

## Input/Output Contract

- Shared profile values:
  - `PreferredPeriod = morning | afternoon | evening`.
  - `AuthoredPreferredWindows`:
    - `weekdays: Weekday[]`;
    - `periods: PreferredPeriod[]`;
    - `firmness: "hard"`.
  - `AuthoredLeadTime`:
    - `days: integer 0..30`;
    - `firmness: "hard"`.
  - Canonical period meaning is display metadata only in Cycle 23:
    - `morning`: before 12:00;
    - `afternoon`: 12:00–17:59;
    - `evening`: 18:00 or later.
  - Cycle 23 does not use these ranges to accept, reject, or rank schedules.

- `PUT /api/people/:id/profile`
  - Path:
    - `id`: positive integer.
  - Body is a full replacement of the authored operational profile:
    ```json
    {
      "preferredWeekdays": ["monday", "wednesday"],
      "preferredPeriods": ["evening"],
      "leadTimeDays": 3,
      "channel": "kakao",
      "unavailableWeekdays": ["friday"]
    }
    ```
  - `preferredWeekdays` and `preferredPeriods` must either both be non-empty or
    both be empty. Both empty clears `preferred_windows`.
  - `leadTimeDays` accepts an integer `0..30` or `null`; null clears
    `lead_time`. Zero is a valid explicit value and must not be treated as
    absent.
  - `channel` uses the existing `none | kakao | sms | email | telegram` enum.
  - `unavailableWeekdays` replaces weekday hard constraints.
  - Duplicate weekdays/periods are normalized away in canonical enum order.
  - A weekday cannot be both preferred and unavailable. Contradictory input is
    rejected before any write.
  - Success:
    - `200 { ok: true, data: { person: PersonRow } }`.
    - The update replaces all five authored fields in one SQLite statement.
  - Failures:
    - `400 VALIDATION_ERROR` for invalid id/body, half-empty preferred-window
      input, out-of-range lead time, or preferred/unavailable overlap.
    - `404 NOT_FOUND` for an unknown person.
    - Validation and not-found failures make no database changes.

- Existing reads:
  - Extend `PersonRow` and therefore directory/detail person payloads with:
    - `preferredWindows: AuthoredPreferredWindows | null`;
    - `leadTime: AuthoredLeadTime | null`.
  - `GET /api/people` also returns these normalized fields so InputHub keeps one
    canonical person contract.
  - Existing `hardConstraints` and `channel` fields remain unchanged.
  - Malformed stored `preferred_windows` or `lead_time` fails open to null; it
    is never displayed as confirmed profile data.
  - Existing plain/null channel values keep current enum/null behavior.

- Storage encoding in existing columns:
  - `people.preferred_windows`:
    - null when cleared;
    - otherwise canonical JSON matching `AuthoredPreferredWindows`.
  - `people.lead_time`:
    - null when cleared;
    - otherwise canonical JSON matching `AuthoredLeadTime`.
  - `people.hard_constraints` keeps the existing canonical JSON array.
  - `people.channel` keeps the existing lowercase enum string.
  - `people.sensitivities` is untouched.

- `/people/:id` frontend:
  - Add a `취급 프로필` section showing preferred days/periods, notice lead
    time, channel, and unavailable weekdays.
  - Unknown values use explicit quiet copy such as `설정 없음`; no inference.
  - Add `프로필 편집` button opening a bottom sheet.
  - The sheet is tap-first:
    - seven weekday toggles for preferred days;
    - morning/afternoon/evening toggles;
    - notice chips for `당일`, `1일`, `3일`, `7일`, `14일`, `30일`, and
      `설정 없음`;
    - contact-channel choices;
    - seven unavailable-weekday toggles.
  - Selecting a preferred day disables or clears the same unavailable day and
    vice versa, so the UI cannot submit a contradiction.
  - Save calls `PUT /api/people/:id/profile`; success closes the sheet and
    refreshes detail.
  - Save failure keeps the sheet and selections visible with a local error.
  - Backdrop tap, Escape, and explicit close dismiss without mutation.
  - No free-text field is introduced.

## Key Changes

- Shared:
  - Add preferred-period, authored preferred-window, and authored lead-time
    schemas/types.
  - Add full-replacement profile request schema.
  - Extend `PersonRowSchema` with normalized nullable profile fields.
  - Keep enum values lowercase and export contracts through the shared barrel.

- Backend:
  - Add fail-open parsers and canonical serializers for preferred windows and
    lead time next to existing people profile helpers.
  - Update every person repository projection through one row-mapping helper so
    lightweight list, event people, directory, detail, create, constraints,
    and profile update cannot drift.
  - Add one repository update for the full authored profile.
  - Add a thin `PUT /api/people/:id/profile` route with shared validation.
  - Keep People reads and writes deterministic and LLM-independent.

- Frontend:
  - Extend `PersonDetail.tsx` with profile display and an accessible bottom
    sheet editor.
  - Reuse the existing weekday labels and semantic design tokens; extract a
    focused component only if it materially reduces `PersonDetail` complexity.
  - Preserve current loading, live/quiet-history, not-found, error, and Access
    states.

- Docs:
  - Update `docs/codebase-map.md` after implementation with new contracts,
    parsing/update ownership, endpoint, and profile editor surface.

## Sprint Contract

- Passing criteria:
  - Shared schemas reject invalid periods, lead times, channels, and malformed
    replacement bodies.
  - Preferred windows and lead time round-trip through SQLite as canonical JSON.
  - Duplicate profile values normalize deterministically.
  - Half-empty preferred-window input is rejected.
  - Preferred/unavailable weekday overlap is rejected without partial writes.
  - `leadTimeDays=0` persists and reads back as zero.
  - Clearing preferred windows and lead time writes SQL null and reads null.
  - Missing person returns 404 without mutation.
  - Malformed stored profile JSON fails open to null while other person fields
    still load.
  - Every person-returning repository path emits the same normalized
    `PersonRow` profile shape.
  - Existing event tagging, weekday constraints, directory stats, detail recent
    meetings, and Decision People Guard do not regress.
  - `/people/:id` displays configured and empty profile states honestly.
  - Profile editing is tap-first and supports save, error retention, and
    non-mutating dismissal.
  - Conflicting weekday choices cannot remain selected in the UI.
  - No LLM dependency or direct proxy call is introduced.
  - No migration is added.
  - `docs/codebase-map.md` is updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Shared unit tests:
    - valid complete profile and complete clear request;
    - invalid period/channel, non-integer/range lead time;
    - half-empty preferred windows and contradictory weekdays.
  - Backend integration tests with temporary SQLite:
    - update and read all authored fields;
    - canonical duplicate/order normalization;
    - zero lead time and null clearing;
    - invalid id, missing person, invalid body, and contradiction errors;
    - no partial mutation after rejected input;
    - malformed stored preferred/lead JSON fails open;
    - all people projections return equivalent normalized profile fields;
    - existing hard-constraint route and Decision guard regression coverage.
  - Frontend tests:
    - configured and empty profile display;
    - open/prefill/close editor;
    - toggle days, periods, lead time, channel, and unavailable days;
    - mutually exclusive preferred/unavailable choices;
    - exact profile PUT body and successful detail refetch;
    - failed save keeps sheet values and shows local error;
    - Escape, backdrop, and close dismiss without fetch mutation;
    - existing detail loading/history-quiet/not-found/error/Access states remain
      covered.

- Manual checks:
  - Mobile and wide layouts.
  - Light and dark themes.
  - Keyboard focus order and focus-visible treatment.
  - 44px minimum targets.
  - Bottom-sheet focus/dismissal behavior.
  - Reduced-motion behavior.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- Existing installations may contain arbitrary legacy text in
  `preferred_windows` or `lead_time`. Reads fail open to null; a successful
  authored save replaces it with canonical JSON rather than guessing meaning.
- Two browser tabs can edit the same person concurrently. Cycle 23 accepts
  last-write-wins for the single-user deployment; version checks are deferred.
- A preferred day with no period, or periods with no day, has no deterministic
  meaning. The API rejects this instead of fabricating a broad preference.

## One Simpler Alternative

Add unrestricted text inputs for preferred windows, lead time, and
sensitivities and save them directly into the existing TEXT columns. This is
faster, but it violates the low-input interaction rule, cannot support future
deterministic slot scoring, and makes contradictory values hard to validate.
Structured tap choices cost more UI work but create reusable, honest inputs.

## Assumptions

- Cycle 23 priority is authored availability/contact profile before notification
  drafts or automatic inference.
- `preferred_windows` and `lead_time` have no active production consumer, so
  canonical JSON encoding does not break an existing behavior.
- Existing non-null values in those columns are treated as untrusted legacy
  text unless they validate against the new schemas.
- User-authored values are confirmed (`firmness: "hard"`). No inferred value is
  stored by this cycle.
- Contact channel remains an authored enum and therefore needs no separate
  firmness column in this cycle.
- Preferred periods are descriptive profile inputs only; exact schedule scoring
  waits for a future Slot B cycle.
- Existing weekday hard constraints remain the only profile values that can
  remove a Decision option.
- The existing `people` table is sufficient; no migration is expected.

## Review Guidance

### Enumeration Required

- Person row projections and normalization:
  - Search: `rg -n "select\\(.*people|PersonRow|preferredWindows|leadTime" server/src shared/src`
  - Expected: every route/repository return path uses one normalized mapping;
    no stale projection silently omits the new fields.

- Profile contract and endpoint:
  - Search: `rg -n "AuthoredPreferredWindows|AuthoredLeadTime|UpdatePersonProfile|api/people/:id/profile" shared/src server/src web/src docs/codebase-map.md`
  - Expected: shared schemas, one backend mutation endpoint, one frontend
    caller, tests, and map entries.

- Existing hard-constraint ownership:
  - Search: `rg -n "hard-constraints|replaceHardConstraints|hardConstraints|unavailableWeekdays" server/src web/src shared/src`
  - Expected: legacy endpoint remains compatible; profile endpoint uses the
    same canonical constraint representation and does not create a second
    incompatible format.

- Person consumers:
  - Search: `rg -n "GET /api/people|/api/people|findAllPeople|findPersonById|findEventWithPeople|findPeopleByIds|findPeopleDirectoryRows" server/src web/src docs/codebase-map.md`
  - Expected: InputHub, event detail/tagging, directory/detail, and Decision
    continue receiving valid shared person rows.

- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src/routes server/src/services web/src`
  - Expected: no new profile dependency on the LLM gateway.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.

### Verification Guide

- JSON encoding, null clearing, malformed legacy data, no-partial-write
  behavior, projection consistency, and Decision regression require real
  temporary SQLite integration tests. Mock-only backend tests are insufficient.
- Shared validation and pure parser/serializer behavior may use unit tests, but
  cannot replace repository integration coverage.
- Frontend tests may mock `apiJson`/fetch, but must assert the exact request
  body, refetch behavior, retained values after failure, mutual exclusion, and
  non-mutating dismissal.
- Manual visual/accessibility verification is required for mobile/wide,
  light/dark, keyboard focus, 44px targets, and reduced motion.
- Reviewer must treat inference, sensitivities, notification drafts, slot
  scoring, name/relation editing, migrations, and LLM use as scope creep.
