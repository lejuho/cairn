# Mirror Ledger A Implementation Plan

Branch: feature/cycle-27-mirror-ledger-a
Cycle: 27
Created: 2026-06-21
Skills: backend-fastify, frontend-react-pwa, design-principles

## Summary

Cycle 27 starts the Mirror surface with the smallest useful read-only ledger:
show moved/cancelled decision cost entries from existing events and annotations.

This advances FR-MIR-02 and FR-MIR-04, and makes FR-DEC-06 visible after the
decision flow already writes structured annotations. It is descriptive only:
no advice, no score, no moralizing copy, and no automatic mutation.

Goal:

- add a deterministic mirror ledger API;
- aggregate moved/cancelled entries by split cost dimensions;
- add a `/mirror` route and app navigation entry;
- render loading, quiet, live, error, and access-session states;
- keep the surface B-temperature and technically descriptive.

Out of scope:

- flake pattern aggregation (FR-MIR-01);
- feasibility trend (FR-MIR-03);
- feature need tracking (FR-MIR-05);
- diary view and reflection prompts (FR-MIR-06/07/08);
- transition count tracking (FR-MIR-09);
- Gmail/refund enrichment;
- new ledger table, migrations, or writes;
- LLM summaries or recommendations.

## Input/Output Contract

- Add `GET /api/mirror/ledger?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Query:
    - `from`: optional literal date. Default: 30 days before `to`.
    - `to`: optional literal date. Default: today in server-local date logic.
    - If both are provided, `from <= to`.
  - Success:
    - `200 { ok: true, data: MirrorLedgerData }`.
  - Failure:
    - `400 VALIDATION_ERROR` for invalid dates or reversed range.
  - Deterministic. No LLM gateway dependency.

- `MirrorLedgerData`
  ```json
  {
    "range": { "from": "2026-06-01", "to": "2026-06-21" },
    "summary": {
      "totalChanges": 3,
      "movedCount": 2,
      "cancelledCount": 1,
      "freeCount": 1,
      "paidCount": 2,
      "moneyTotal": 12000,
      "socialTotal": 3,
      "effortBreakdown": { "none": 1, "low": 1, "medium": 1, "high": 0, "unknown": 0 }
    },
    "entries": [
      {
        "annotationId": 42,
        "eventId": 10,
        "eventTitle": "팀 회의",
        "thread": { "id": 1, "name": "프로젝트" },
        "outcome": "moved",
        "reasonText": "conflict_resolution",
        "reasonTags": ["conflict_resolution"],
        "loggedAt": "2026-06-21T09:00:00",
        "eventStart": "2026-06-21T10:00:00+09:00",
        "cost": {
          "money": 12000,
          "social": 2,
          "effort": "medium",
          "window": "same_day",
          "hasAnyCost": true
        }
      }
    ],
    "sampleStatus": "ok"
  }
  ```

- Ledger inclusion rules:
  - Include annotation-backed changes where `annotations.outcome` is
    `moved` or `cancelled`.
  - Join each annotation to its event to read `cancel_money`, `cancel_social`,
    `cancel_effort`, `cancel_window`, `start`, `thread_id`, and title.
  - Include entries whose `logged_at` literal date is inside `[from, to]`.
  - Entries without a matching event are ignored in A-level UI data but covered
    by integration tests as non-crashing.
  - Do not include raw status-only event rows without annotations in Cycle 27.
    Copy must be honest that the ledger reflects recorded annotations, not all
    possible changes.

- Cost rules:
  - Keep cost dimensions split. Do not expose a scalar total score.
  - `freeCount` means money=0, social=0, and effort is `none` or empty.
  - `paidCount` means any money/social/effort cost exists.
  - `moneyTotal` sums numeric `cancel_money`.
  - `socialTotal` sums numeric `cancel_social`.
  - `effortBreakdown` buckets `none|low|medium|high|unknown`; unknown covers
    null, empty, or unrecognized values.
  - `sampleStatus="low_sample"` when `totalChanges < 3`, else `"ok"`.
    The UI should say sample is thin, not draw conclusions.

## Key Changes

- Shared:
  - Add `shared/src/mirror.ts` with:
    - `MirrorLedgerQuerySchema`;
    - `MirrorLedgerCostSchema`;
    - `MirrorLedgerEntrySchema`;
    - `MirrorLedgerSummarySchema`;
    - `MirrorLedgerDataSchema`;
    - `MirrorLedgerResponseSchema`.
  - Export from `shared/src/index.ts`.

- Backend:
  - Add a focused repository read, for example
    `server/src/repositories/mirror.ts`:
    - query moved/cancelled annotations;
    - join events and optional threads;
    - read only needed columns;
    - order newest first by `logged_at`, then annotation id desc.
  - Add a pure service, for example `server/src/services/mirror-ledger.ts`:
    - parse reasonTags JSON fail-open to `[]`;
    - normalize cost values;
    - compute summary counts and buckets;
    - set sampleStatus.
  - Add `server/src/routes/mirror.ts` and register it in `app.ts` when DB
    exists.
  - Keep the route thin: validate query, call service, return shared schema
    shape.
  - Keep deterministic behavior with no LLM import.
  - No migration expected. If `db:generate` emits schema changes, stop and
    reassess before adding migrations.

- Frontend:
  - Add `/mirror` route in `web/src/App.tsx`.
  - Add `MirrorLedger.tsx`.
  - Add `거울` link to `AppNav`.
  - Use `apiJson` and shared schemas/types.
  - Five screen states:
    - loading;
    - quiet: no entries, copy like `아직 기록된 이동/취소 원장이 없어`;
    - live: summary chips + newest-first ledger list;
    - error: retry action;
    - access_error: existing Access recovery copy/action.
  - B-temperature surface:
    - use `.warm` for quiet/summary shell where appropriate;
    - use semantic tokens only;
    - descriptive copy only, no advice like "줄여야 해".
  - Show sample warning when `sampleStatus="low_sample"`:
    - copy example: `표본이 적어 패턴으로 보긴 이르다`.
  - Entry cards show:
    - event title;
    - outcome moved/cancelled;
    - money/social/effort/window chips;
    - reason text/tags if present;
    - event thread link when available.

- Docs:
  - Update `docs/codebase-map.md` with mirror route, service/repository, shared
    schema, `/mirror` UI, and nav entry.

## Sprint Contract

- Passing criteria:
  - `GET /api/mirror/ledger` returns valid `MirrorLedgerData`.
  - Invalid/reversed date ranges return stable 400 without DB writes.
  - Moved/cancelled annotations are included; done/late/raw annotations are not.
  - Entries are filtered by `logged_at` literal date.
  - Entries are ordered newest first, annotation id desc as tie-breaker.
  - Event cost dimensions remain split; no scalar score is exposed.
  - Summary counts moved/cancelled, free/paid, money/social totals, and effort
    buckets correctly.
  - Malformed `reason_tags` JSON is fail-open and does not crash.
  - Missing event join rows do not crash the route.
  - Route/service/repository have no LLM dependency.
  - No migration or new table is added.
  - `/mirror` renders loading, quiet, live, error, and access-session states.
  - `/mirror` live state shows summary, low-sample copy, and ledger entries.
  - App navigation includes `/mirror` and marks it active.
  - Mirror copy is descriptive only and avoids recommendation/moralizing.
  - `docs/codebase-map.md` is accurate and updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Shared unit:
    - valid mirror ledger payload parses;
    - invalid outcome/sampleStatus/query date fails;
    - cost buckets reject scalar score fields if present.
  - Pure backend unit:
    - summary aggregation for moved/cancelled entries;
    - free vs paid classification;
    - malformed reasonTags fail-open;
    - low sample threshold.
  - Backend integration with temporary SQLite:
    - endpoint includes moved/cancelled annotations joined to events;
    - done/late annotations excluded;
    - date range filters by `logged_at`;
    - malformed reason tags do not 500;
    - invalid date/reversed range returns 400;
    - route works with no LLM gateway.
  - Frontend:
    - AppNav renders `거울` link and `aria-current` on `/mirror`;
    - `/mirror` quiet state;
    - `/mirror` live summary and entries;
    - low-sample copy;
    - generic error retry;
    - access-session recovery.
  - Manual checks:
    - mobile and wide `/mirror`;
    - light and dark themes;
    - keyboard focus through nav, retry, and thread links;
    - 44px targets and reduced motion.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- Existing event status changes without annotations will not appear in Ledger A.
  This is intentional: A-level ledger mirrors recorded annotation evidence only.
- `logged_at` is stored as SQLite datetime without timezone offset. Date range
  filtering must use literal `YYYY-MM-DD` slicing/comparison and document the
  limitation instead of pretending timezone precision.
- A future Gmail cost parser may add refund/money detail. Ledger A should keep
  split dimensions and avoid schema that forces a single score.

## One Simpler Alternative

Only render a frontend-only summary from `/api/today` or event detail calls.
This avoids a new route but cannot show historical entries or stable range
queries. A small deterministic API is the smallest useful Mirror foundation.

## Assumptions

- Decision resolve already writes structured annotations with outcome
  `moved` or `cancelled`.
- Push annotation intake can also create moved/cancelled entries.
- The ledger is read-only and derived from existing tables.
- `cancel_effort` values may be messy; unknown is acceptable and more honest
  than coercing them.
- Mirror is a reflection/B-temperature surface, not a decision surface.
- Current AppNav can accept one more top-level link without a layout redesign.

## Review Guidance

### Enumeration Required

- Mirror API contract:
  - Search: `rg -n "MirrorLedger|mirror/ledger|registerMirror|mirror" shared/src server/src web/src`
  - Expected: shared schemas, server route/service/repository, frontend screen,
    tests, and docs map all use one contract.

- Annotation/event source of truth:
  - Search: `rg -n "outcome|reasonTags|cancelMoney|cancelSocial|cancelEffort|cancelWindow|loggedAt" server/src shared/src`
  - Expected: ledger reads existing annotations/events only and does not add
    write paths.

- LLM boundary:
  - Search: `rg -n "completeChat|LLM_PROXY_BASE_URL|createLlmGateway|mirror" server/src`
  - Expected: no mirror route/service/repository imports or calls LLM gateway.

- Frontend navigation and route:
  - Search: `rg -n "mirror|거울|AppNav|aria-current" web/src`
  - Expected: `/mirror` route, nav link, active state tests, and B-temperature
    screen states.

- Scope creep boundaries:
  - Search: `rg -n "flake|diary|STAR|resume|Gmail|refund|recommend|should|줄여|고쳐" server/src web/src shared/src docs/codebase-map.md`
  - Expected: no flake pattern, diary, CV export, Gmail enrichment, or
    prescriptive/moralizing mirror copy in Cycle 27.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files unless `db:generate` proves a necessary
    schema change and the plan is amended before implementation.

### Verification Guide

- Repository/date filtering requires SQLite integration tests against a real
  temporary database. Mock-only tests are insufficient.
- Summary aggregation can be pure unit-tested because it is deterministic.
- Frontend may mock `apiJson`, but must validate visible states, nav active
  behavior, low-sample copy, and no advice-like copy.
- Manual UI verification remains required until visual regression coverage
  exists: mobile/wide, light/dark, keyboard focus, 44px targets, reduced motion.
