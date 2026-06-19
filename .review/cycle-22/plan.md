# People Directory A Implementation Plan

Branch: `feature/cycle-22-people-directory-a`
Cycle: `22`
Created: `2026-06-19`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Cycle 21 derives relationship counts, last-met timestamps, and frequency bands,
but exposes them only inside conflict decisions. Cycle 22 turns that existing
deterministic data into the first People directory surface:

- list people with relationship memory;
- open a person detail view;
- show qualifying recent meetings and confirmed hard constraints;
- make People directly reachable from app navigation.

This advances FR-PPL-02's visible relationship memory and the People directory
defined in spec section 6.2. Time-pattern inference remains deferred.

Out of scope:

- Automatic person/profile inference.
- Time-pattern inference or preferred-window scoring.
- Profile editing beyond the existing weekday constraint flow.
- Notification draft generation or delivery.
- Person merge/dedup.
- Person filtering/highlighting on Today.
- Social-cost threshold changes.
- New LLM use.
- New tables or migrations.

Preparation pass creates only `.review/cycle-22/*` artifacts and stops before
implementation.

## Input/Output Contract

- `GET /api/people/directory?now=<ISO datetime>`
  - Input:
    - `now`: required RFC3339 datetime with offset.
  - Output:
    - `{ ok: true, data: { people: PersonDirectoryRow[] } }`.
  - `PersonDirectoryRow`:
    - existing normalized person fields: `id`, `name`, `relation`, `channel`,
      `hardConstraints`;
    - `totalMeets`;
    - `lastMet: string | null`;
    - `frequencyBand: cold_start | rare | established | frequent`.
  - Statistics reuse Cycle 21 semantics exactly:
    - linked event ended before `now` by epoch comparison;
    - status is `done` or `confirmed`;
    - `planned`, `cancelled`, `moved`, `late`, malformed, and future rows do not
      count;
    - no GET-time cache writes.
  - Stable sort:
    - `lastMet` descending by epoch;
    - null `lastMet` after known values;
    - name ascending, then id ascending as tie-breakers.
  - Failure: `400 VALIDATION_ERROR`.

- `GET /api/people/:id/detail?now=<ISO datetime>`
  - Input:
    - `id`: positive integer;
    - `now`: required RFC3339 datetime with offset.
  - Output:
    - `{ ok: true, data: { person, recentMeetings } }`.
    - `person`: same `PersonDirectoryRow` contract.
    - `recentMeetings`: at most 10 `EventRow` values qualifying under the same
      done/confirmed and end-before-now rules.
    - Recent meetings sort newest-ended first by epoch, then event id ascending.
  - Failures:
    - `400 VALIDATION_ERROR`.
    - `404 NOT_FOUND`.

- Existing APIs:
  - Keep `GET /api/people` unchanged for lightweight InputHub selection.
  - Keep `PUT /api/people/:id/hard-constraints` unchanged.
  - Do not add stats to every lightweight people fetch.

- Frontend routing and navigation:
  - Add `/people` directory route.
  - Add `/people/:id` detail route.
  - Add `사람` link to `AppNav`; active route uses `aria-current="page"`.
  - Preserve `/today`, `/input`, and `/threads` navigation.

- `/people` directory:
  - States: loading, quiet, live, error, access_error.
  - Quiet: no people, short explanation plus link to `/input` for first person
    creation.
  - Live cards show name, optional relation, total meeting count, localized
    last-met date/time, and frequency-band copy.
  - Null data stays explicit: `만남 기록 없음`; do not infer a relationship.
  - Card tap navigates to `/people/:id`.

- `/people/:id` detail:
  - States: loading, quiet, live, error, access_error.
  - Header shows name, optional relation, and configured channel.
  - Relationship memory shows total meetings, last met, and frequency band.
  - Confirmed weekday hard constraints render from normalized structured data.
  - Recent meetings show title and stored time window, newest first.
  - Quiet state means the person exists but has no qualifying meeting history.
  - 404 renders a specific not-found state with a link back to `/people`.

## Key Changes

- Shared:
  - Add `PersonDirectoryQuerySchema`.
  - Add `PersonDirectoryRowSchema`, directory response schema, and person-detail
    response schema.
  - Reuse `EventRowSchema`, `PersonRowSchema`, and existing frequency-band
    vocabulary; do not duplicate incompatible strings.

- Backend:
  - Reuse/refactor Cycle 21 relationship-stat helpers so Decision and People
    directory share one qualifying-event rule.
  - Add repository query for qualifying recent meetings with epoch-safe sort.
  - Add thin directory/detail routes under the existing people route module or
    a focused people-directory module if route size requires it.
  - Keep reads deterministic and LLM-independent.

- Frontend:
  - Add `PeopleDirectory.tsx` and `PersonDetail.tsx`.
  - Register `/people` and `/people/:id` in `App.tsx`.
  - Add `사람` to `AppNav`.
  - Use `apiJson` for every directory/detail request and Access recovery.
  - Add semantic-token styling with 44px targets and reduced-motion behavior.

- Docs:
  - Update `docs/codebase-map.md` after implementation with new shared
    contracts, routes/repository helpers, screens, and navigation paths.

## Sprint Contract

- Passing criteria:
  - Directory query validates required `now`.
  - Empty DB returns an empty people array.
  - Every person appears once with normalized hard constraints.
  - `totalMeets`, `lastMet`, and frequency band match Cycle 21 semantics.
  - Mixed RFC3339 offsets are compared and sorted by epoch.
  - Null/malformed event timestamps never become relationship evidence.
  - Directory order follows last-met/null/name/id contract.
  - Detail validates id and `now`; missing person returns 404.
  - Recent meetings include only qualifying linked events.
  - Recent meetings are epoch-sorted and limited to 10.
  - Existing lightweight people and hard-constraint APIs do not regress.
  - `/people` implements loading, quiet, live, error, and Access states.
  - `/people/:id` implements loading, quiet, live, error/not-found, and Access
    states.
  - Cards navigate to detail; back navigation is usable.
  - Existing Today/Input/Threads nav remains usable and active-state semantics
    are correct.
  - Unknown profile values remain empty/explicit, never inferred.
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
    - directory empty/list behavior and query validation;
    - one row per person with hard constraints normalized;
    - qualifying done/confirmed events counted;
    - planned/cancelled/moved/late/future/malformed events excluded;
    - mixed-offset total and `lastMet` correctness;
    - directory sort with known, tied, and null `lastMet`;
    - detail invalid id, invalid now, and missing person errors;
    - detail recent meeting filter, epoch order, tie-break, and limit 10;
    - existing `GET /api/people` and constraint replacement regressions.
  - Frontend:
    - AppNav renders four destinations and correct active state;
    - directory loading/quiet/live/error/Access states;
    - null relation/lastMet copy;
    - card navigation to detail;
    - detail loading/quiet/live/not-found/error/Access states;
    - detail displays channel, stats, hard constraints, and recent meetings;
    - retry and Access-login actions use expected navigation/fetch behavior;
    - existing App route and primary-screen tests remain passing.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- Two events represent the same real meeting due to duplicate external import.
  Cycle 22 counts persisted event rows; dedup belongs to sync identity, not this
  directory.
- A person has more than 10 qualifying events sharing the same end instant.
  Event-id tie-break must make recent history stable.
- User opens detail while the person is deleted or renamed elsewhere. A fresh
  fetch owns the result; no stale local person object is treated as truth.

## One Simpler Alternative

Render relationship counts directly inside the existing InputHub checklist.
This avoids routes and screens, but it mixes event creation with relationship
memory and cannot provide a usable person detail surface. A small purpose-built
directory matches spec section 6.2 and prepares notification drafts without
overloading `/input`.

## Assumptions

- Cycle 22 priority is People Directory A before notification drafts.
- Cycle 21 frequency thresholds remain unchanged and are the single source of
  truth.
- `done` and past `confirmed` events remain A-level meeting evidence.
- Stored `people.total_meets` and `people.last_met` remain unused caches; this
  cycle derives values at read time.
- Existing `people`, `event_people`, and `events` columns are sufficient.
- Person deletion is not implemented; 404 covers externally removed rows.
- Directory is read-only in A except links to existing input/constraint flows.

## Review Guidance

### Enumeration Required

- Shared people-directory contracts:
  - Search: `rg -n "PersonDirectory|recentMeetings|frequencyBand" shared/src server/src web/src docs/codebase-map.md`
  - Expected: shared schemas/types, server route/repository, both screens,
    tests, and map entries.

- Relationship-rule reuse:
  - Search: `rg -n "queryMeetingStats|totalMeets|lastMet|done.*confirmed|Date.parse|unixepoch" server/src`
  - Expected: one qualifying-history rule shared by Decision and directory;
    no divergent status/time comparisons.

- Route enumeration:
  - Search: `rg -n "api/people.*directory|api/people.*detail" server/src shared/src web/src`
  - Expected: exactly the two new read endpoints and their callers/tests.

- Navigation/routes:
  - Search: `rg -n '"/people|사람|PeopleDirectory|PersonDetail' web/src docs/codebase-map.md`
  - Expected: App route, AppNav, cards/detail links, tests, map.

- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src/routes server/src/services web/src`
  - Expected: no new People directory dependency on LLM.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.

### Verification Guide

- Relationship counts, status filtering, mixed offsets, ordering, and limit 10
  require real temporary SQLite integration tests. Mock-only backend tests are
  insufficient.
- Pure display mapping may use focused unit tests, but cannot replace repository
  integration coverage.
- Frontend may mock `apiJson`/fetch responses, but must verify exact URLs,
  retry behavior, Access recovery, and navigation.
- Manual verification: mobile and wide layout, light/dark themes, keyboard
  focus, 44px targets, and reduced motion.
- Reviewer must treat profile inference/editing, notification drafts, filters,
  threshold changes, LLM use, and migrations as scope creep.
