# Mirror Diary View A Implementation Plan

Branch: feature/cycle-37-mirror-diary-view-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 37 implements the first read-only slice of FR-MIR-06 and a small,
bounded slice of FR-MIR-08.

Current state:

- `/mirror` already shows ledger, flake patterns, energy trends, and
  automation-needs.
- `annotations` already preserve the raw/reflection text in `reason_text`, and
  `server/src/repositories/mirror.ts` already joins annotations to events and
  threads through `findAllOutcomeAnnotations`.
- There is no time-axis diary/reflection lens yet.

This cycle adds:

- a deterministic `GET /api/mirror/diary?from&to` endpoint;
- a pure service that turns existing annotations into time-ordered diary
  entries grouped by local calendar date;
- a `/mirror` diary section that shows recent reflective entries with B
  temperature, descriptive copy, event/thread context, and no judgment;
- shared strict schemas and tests for the diary payload.

Out of scope:

- new push scheduling for "오늘 기억에 남는 거?" prompts;
- Telegram/Web Push changes;
- new manual long-form diary entry editor;
- LLM generation or summarization;
- sentiment scoring, productivity scoring, streaks, badges, or advice;
- database migration.

## Input/Output Spec

- Input:
  - `GET /api/mirror/diary?from&to`
    - Query:
      - optional `from`, `to`: strict calendar `YYYY-MM-DD`;
      - `from <= to`;
      - max 90-day range;
      - default range: last 30 days ending at server-local today.

- Storage:
  - No new table and no writes.
  - Reads existing `annotations` joined to `events` and optional `threads`.

- Output:
  - `GET /api/mirror/diary?from&to`
    - Returns `{ range, days, sampleStatus }`.
    - `days` is newest-first by date.
    - Each day includes:
      - `date`;
      - `headline`: first non-empty `reasonText` for that day, otherwise `null`;
      - `entries`.
    - Each entry includes:
      - `annotationId`;
      - `eventId`;
      - `eventTitle`;
      - `eventStart`;
      - optional thread `{ id, name }`;
      - `outcome`;
      - `reasonText`;
      - `reasonTags`;
      - `loggedAt`;
      - `depth: "automatic" | "semi_auto"`;
      - `contextLabel`.
    - `depth` is deterministic:
      - `semi_auto` when `reasonText` is non-empty;
      - `automatic` when no text exists and only event/outcome context is shown.
    - No `score`, `sentiment`, `recommendation`, `advice`, `streak`, or
      `action` field appears in the payload.

- Failure:
  - Invalid date shape, overflow date, reversed range, or >90-day range returns
    stable `VALIDATION_ERROR`.
  - Missing/orphan event rows are ignored in the first slice so the diary stays
    event-grounded and does not hallucinate context.

## Key Changes

- Shared:
  - Extend `shared/src/mirror.ts` with strict schemas/types:
    - `MirrorDiaryQuerySchema`;
    - `MirrorDiaryDepthSchema`;
    - `MirrorDiaryEntrySchema`;
    - `MirrorDiaryDaySchema`;
    - `MirrorDiaryDataSchema`;
    - `MirrorDiaryResponseSchema`.
  - Add tests in `shared/src/mirror.test.ts`:
    - accepts valid diary payload;
    - rejects injected `score`/`recommendation`/`advice`;
    - rejects invalid depth;
    - rejects overflow/reversed/>90-day query.

- Backend:
  - Add pure service `server/src/services/mirror-diary.ts`:
    - resolves default date range from route-provided `today`;
    - filters by `loggedAt.slice(0,10)` inside `[from,to]`;
    - excludes rows with missing `eventId`, `eventTitle`, or `loggedAt`;
    - groups by date newest-first;
    - sorts entries newest-first by `loggedAt`, tie-break `annotationId` desc;
    - derives `headline`, `depth`, and `contextLabel`;
    - returns `sampleStatus="low_sample"` when entries `<3`.
  - Extend `server/src/routes/mirror.ts`:
    - register `GET /api/mirror/diary?from&to`;
    - validate query with shared schema;
    - call `findAllOutcomeAnnotations(db)` and pure service;
    - no DB writes, no LLM, no network.

- Frontend:
  - Extend `web/src/MirrorLedger.tsx`:
    - fetch `/api/mirror/diary` in parallel with existing Mirror sections;
    - keep diary fetch failure non-fatal, same as automation-needs;
    - include diary entries in quiet/live decision so annotation-only diary data
      is not hidden;
    - render `MirrorDiary` section with B-temperature heading/copy, day groups,
      event title, optional thread link, outcome chip, reason text, and depth
      chip;
    - render no advice or CTA pressure.
  - Extend `web/src/styles.css`:
    - semantic-token-only diary styles;
    - warm/B reflection surface; serif only for the diary heading if needed;
    - touch targets >=44px for thread links.

- Docs:
  - Update `docs/codebase-map.md` with:
    - `GET /api/mirror/diary`;
    - new service/schema names;
    - `/mirror` diary UI section.

## Sprint Contract

- Pass criteria:
  - Diary route validates strict date queries and rejects overflow/reversed/>90d
    ranges.
  - Diary route is read-only and deterministic; no DB write, no LLM, no
    external network.
  - Diary service groups existing annotations by `loggedAt` calendar date,
    newest-first, with stable tie-breaks.
  - Missing event/thread context is fail-open without hallucination; orphan rows
    are excluded.
  - `depth` is derived deterministically from existing data only.
  - Payload schemas are strict and reject injected recommendation/action/scoring
    fields.
  - `/mirror` renders diary section in loading/quiet/live/error/access-session
    states without regressing existing Mirror sections.
  - Diary section uses B-temperature reflection styling, semantic tokens, and
    descriptive/non-judgmental copy.
  - `docs/codebase-map.md` is updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static boundary check for no LLM/GCal/Gmail/Telegram/fetch/network imports
    in `server/src/services/mirror-diary.ts` and the route path beyond existing
    frontend API calls.

- Test cases:
  - Unit:
    - date-range default resolves to last 30 days inclusive;
    - filters by `loggedAt.slice(0,10)` inside range;
    - groups and sorts days/entries newest-first with id desc tie-break;
    - first non-empty reasonText becomes day headline;
    - empty reasonText yields `automatic`, non-empty yields `semi_auto`;
    - orphan/missing event rows are excluded;
    - low sample when total entries <3.
  - SQLite integration:
    - route returns days/entries from real DB annotations joined to events and
      threads;
    - invalid date/reversed/>90d range returns 400 `VALIDATION_ERROR`;
    - no mutation occurs on read.
  - Web:
    - `/mirror` fetches diary endpoint;
    - diary-only annotation data enters live state instead of quiet masking;
    - diary day group and entry render reason text, event context, outcome, and
      thread link;
    - diary fetch failure does not fail the whole Mirror screen;
    - existing ledger/pattern/energy/automation sections still render.
  - Manual/source:
    - Mobile/light/dark/reduced-motion source or headless evidence recorded if
      browser execution is unavailable.

- gas limit: N/A
- slither pass: N/A

## 누락된 엣지 케이스 후보 3개

- Multiple annotations on the same event/day with identical `loggedAt`. Expected:
  deterministic id-desc ordering.
- Annotation has `reasonText` whitespace only. Expected: treated as empty and
  depth remains `automatic`.
- Diary route has valid `from` but omitted `to`. Expected: default `to=today`
  and still enforce resolved range <=90 days.

## 더 단순한 대안 1개

Render existing Mirror ledger entries as a "diary" section without a new route.
Rejected because ledger only covers moved/cancelled outcomes, while FR-MIR-06 is
the time-axis reflection lens over all annotation outcomes.

## Assumptions

- `annotations.logged_at` is acceptable as the diary time axis for A-level.
- `reason_text` is the only existing free-text reflection material; this cycle
  does not introduce a new diary table.
- The first diary slice may classify only `automatic` and `semi_auto`; the
  "manual long entry" depth remains a later cycle because no manual diary editor
  exists yet.
- Browser manual checks may be replaced by explicit source/headless evidence if
  browser access is unavailable.

## Review Guidance

### Enumeration 필요 항목

- Mirror routes and schemas:
  - Search: `rg -n "mirror/diary|MirrorDiary|Mirror.*QuerySchema|registerMirrorRoutes" shared/src server/src web/src`
  - Verify route, shared schema, service, and UI agree on exact payload shape.

- Read-only/no-mutation boundary:
  - Search: `rg -n "insert|update|delete|transaction|upsert|completeChat|LLM_PROXY_BASE_URL|telegram|googleapis|gmail|fetch\\(" server/src/services/mirror-diary.ts server/src/routes/mirror.ts`
  - Expected in new diary service: no hits. Route may contain existing imports
    for other endpoints, but diary block must not write or call external
    services.

- Mirror UI state boundary:
  - Search: `rg -n "loadMirrorData|isEmpty|MirrorDiary|mirror-diary" web/src/MirrorLedger.tsx web/src/MirrorLedger.test.tsx`
  - Verify diary-only data is not hidden by quiet-state logic.

### 검증 방식 가이드

- Query validation:
  - Shared unit tests cover schema shape.
  - Route integration tests are required to prove HTTP 400 error shape.

- DB join behavior:
  - Mock tests are insufficient.
  - Use SQLite integration tests with real temporary DB rows for annotations,
    events, and threads.

- Diary grouping/sorting:
  - Pure unit tests are sufficient for deterministic grouping and tie-breaks.

- UI:
  - JSDOM tests required for loading/quiet/live/error/access-session boundaries
    that this cycle touches.
  - Source/headless evidence acceptable for light/dark/reduced-motion/touch
    constraints if manual browser is unavailable.

- Scope creep:
  - Any push prompt scheduler, Telegram/Web Push change, LLM summary, new diary
    write endpoint, score/sentiment/streak, or automatic recommendation is
    outside this plan and should block review.
