# Mirror Pattern A Implementation Plan

Branch: feature/cycle-28-mirror-patterns-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 27 made `/mirror` useful as a read-only decision-cost ledger
(FR-MIR-02/04). Cycle 28 adds the smallest useful FR-MIR-01 slice: descriptive
flake pattern aggregation by weekday, event type, and thread.

This cycle must stay read-only and deterministic. It must not add a new table,
migration, LLM call, recommendation engine, score, alert, or automation
suggestion. The output is evidence and counts only: Cairn reflects recorded
annotations; the user decides what, if anything, to change.

Out of scope:

- feasibility trend / deficit days (FR-MIR-03);
- automation-need tracking (FR-MIR-05);
- diary view or retrospective questions (FR-MIR-06/07/08);
- transition-count recording (FR-MIR-09);
- GCal/Gmail/push changes;
- new writes, cron, or generated advice.

## Input/Output Spec

- Input:
  - `GET /api/mirror/patterns?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `from` and `to` are optional.
  - Date parsing should reuse the strict real-calendar date validation from the
    Mirror ledger query contract.
  - If both are present, `from <= to`.
  - Default range: same as ledger A — `to=today`, `from=to-30d`, with `today`
    resolved at the route edge and injected into the pure service.

- Output:
  - Success:
    - `200 { ok: true, data: MirrorPatternsData }`
    - Proposed shape:

```json
{
  "range": { "from": "2026-06-01", "to": "2026-06-30" },
  "totals": {
    "annotations": 8,
    "done": 3,
    "moved": 2,
    "cancelled": 1,
    "late": 2,
    "slipCount": 5
  },
  "weekday": [
    {
      "key": "monday",
      "label": "월요일",
      "total": 3,
      "outcomes": { "done": 1, "moved": 1, "cancelled": 0, "late": 1 },
      "slipCount": 2,
      "slipRatio": 0.667,
      "sampleStatus": "ok"
    }
  ],
  "type": [
    {
      "key": "meet",
      "label": "meet",
      "total": 4,
      "outcomes": { "done": 2, "moved": 1, "cancelled": 0, "late": 1 },
      "slipCount": 2,
      "slipRatio": 0.5,
      "sampleStatus": "ok"
    }
  ],
  "thread": [
    {
      "key": "thread:1",
      "thread": { "id": 1, "name": "프로젝트" },
      "label": "프로젝트",
      "total": 3,
      "outcomes": { "done": 1, "moved": 1, "cancelled": 1, "late": 0 },
      "slipCount": 2,
      "slipRatio": 0.667,
      "sampleStatus": "ok"
    }
  ],
  "sampleStatus": "ok"
}
```

  - Failure:
    - Invalid date format, impossible calendar date, or reversed range:
      `400 { ok:false, error:{ code:"VALIDATION_ERROR", message:string } }`
    - The route is DB-backed and deterministic. No LLM-unavailable failure
      state exists.

Definitions:

- `slipCount = moved + cancelled + late`.
- `done` is the non-slip comparison outcome.
- `slipRatio = slipCount / total`, rounded to a stable small precision in the
  service; it is a descriptive ratio, not a score or recommendation.
- `sampleStatus = "low_sample"` when `total < 3`, otherwise `"ok"`.
- Weekday uses `events.start` only. If `events.start` is null or malformed, put
  the row in an explicit `unknown` weekday bucket. Do not use `logged_at` as a
  proxy for event weekday.
- Type uses `events.type`; null/blank becomes an `unknown` type bucket.
- Thread uses `events.thread_id` joined to `threads`; no thread becomes a
  `thread:null` bucket with a neutral label such as `스레드 없음`.
- Rows with a missing event join are excluded. Unknown values stay explicit;
  do not infer.

## Key Changes

- Shared:
  - Extend `shared/src/mirror.ts` with pattern schemas/types:
    - `MirrorPatternOutcomeCountsSchema`;
    - `MirrorPatternSampleStatusSchema` or reuse the existing mirror sample enum
      if the semantics stay identical;
    - `MirrorPatternBucketSchema`;
    - `MirrorPatternsTotalsSchema`;
    - `MirrorPatternsDataSchema`;
    - `MirrorPatternsResponseSchema`.
  - Consider extracting the existing strict date-range query into a reusable
    `MirrorRangeQuerySchema`, while preserving `MirrorLedgerQuerySchema` as an
    alias/export to avoid churn.
  - Add shared unit tests for valid pattern payloads, required outcome keys,
    low-sample status, strict date range validation, and no extra scalar
    recommendation field if `.strict()` is used on buckets.

- Backend:
  - Extend `server/src/repositories/mirror.ts` with a read-only query for all
    annotation outcomes (`done`, `moved`, `cancelled`, `late`) joined to events
    and optional threads. Select only fields required by the pure service:
    annotation id/outcome/logged_at, event id/title/type/start/thread_id, and
    thread id/name.
  - Add a pure service, for example `server/src/services/mirror-patterns.ts`:
    - resolve default range from injected `today`;
    - filter by `annotation.logged_at.slice(0,10)` within `[from,to]`;
    - exclude empty `logged_at` and missing-event rows;
    - group independently by weekday, type, and thread;
    - produce stable counts, slip ratios, sample status, and sort order;
    - no DB, Date.now, LLM, or route-specific code inside the service.
  - Extend `server/src/routes/mirror.ts` with
    `GET /api/mirror/patterns`, keeping the handler thin:
    validate query → repository read → service build → typed response.
  - Add route integration tests against a real temp SQLite DB.

- Frontend:
  - Extend `web/src/MirrorLedger.tsx` or split a small presentational
    `MirrorPatterns` component if it keeps the file readable.
  - `/mirror` should load ledger and patterns for the same default range.
  - Preserve the five states: loading, quiet, live, error,
    access_session_required.
  - Quiet state should remain rewarding when both ledger entries and pattern
    annotations are empty.
  - Live state should show a compact pattern section above or near the ledger:
    weekday/type/thread buckets with counts and neutral ratio copy.
  - Copy must be descriptive only:
    - allowed: `월요일 기록 3건 중 이동/취소/지각 2건`
    - disallowed: `월요일 약속을 줄여`, `고쳐야 해`, `위험`, `나쁜 패턴`
  - Use B-temperature Mirror styling: semantic tokens, `.warm`, no hardcoded
    colors, no required motion, 44px interactive targets.
  - Access and generic error recovery must continue to use the existing
    `apiJson` error classification.

- Docs:
  - Update `docs/codebase-map.md` with the new shared schemas, backend route,
    repository/service ownership, and `/mirror` pattern section.

## Sprint Contract

- Pass criteria:
  - `GET /api/mirror/patterns` returns valid `MirrorPatternsData`.
  - Invalid, impossible, or reversed date ranges return stable 400 responses.
  - The route includes `done`, `moved`, `cancelled`, and `late` annotations, and
    excludes annotations with null/unknown outcomes.
  - Date filtering uses annotation `logged_at`, not event start.
  - Weekday grouping uses event `start`; missing/malformed start becomes
    `unknown`, not guessed from logged_at.
  - Type and thread nulls are explicit `unknown`/`thread:null` buckets.
  - Missing event joins are excluded without crashing.
  - Sorting is stable:
    - weekday: Monday→Sunday→unknown;
    - type/thread: total desc, slipCount desc, label asc, id/key asc.
  - `slipCount = moved + cancelled + late`; `done` is separate.
  - No bucket exposes a recommendation, moral judgment, hidden weight, or
    scalar "score".
  - `/mirror` still shows ledger data and now renders pattern buckets.
  - All Mirror UI states remain covered: loading, quiet, live, error,
    access_session_required.
  - No migration, write path, cron, or LLM dependency is introduced.
  - `docs/codebase-map.md` is updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Shared unit:
    - valid `MirrorPatternsData` parses;
    - invalid outcome key or missing count key fails;
    - pattern buckets reject unexpected recommendation/score fields if strict;
    - date range validation still rejects bad format, impossible dates, and
      reversed ranges.
  - Service unit:
    - groups the same source rows independently by weekday, type, and thread;
    - counts all four outcomes and computes slipCount/slipRatio;
    - date filtering uses logged_at;
    - event start null/malformed goes to `unknown` weekday;
    - type null/blank goes to `unknown`;
    - no thread goes to `thread:null`;
    - low sample threshold works;
    - sort order is stable.
  - Backend integration:
    - endpoint returns all three bucket collections from real SQLite rows;
    - invalid/impossible/reversed date returns 400;
    - missing event join is excluded;
    - no LLM gateway needed for `/api/mirror/patterns`.
  - Frontend:
    - `/mirror` live state renders pattern section and existing ledger;
    - quiet state when both pattern totals and ledger entries are empty;
    - low-sample copy is neutral;
    - generic error and access-session recovery still render;
    - copy does not include prescriptive/moralizing banned words.
  - Manual checks:
    - mobile and wide `/mirror`;
    - light and dark themes;
    - keyboard focus through nav, retry, and thread links;
    - 44px targets and reduced motion.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- A row has `outcome='done'` but `events.start` is null: it should count in
  totals and type/thread buckets, and in weekday `unknown`.
- A bucket has `total=0` only because a future refactor preinitializes all
  weekdays: service should either omit empty buckets or keep ratio `0` without
  NaN/Infinity.
- Thread was deleted historically or the join misses: the source row should not
  invent a thread name; use `thread:null` only when the event exists but has no
  thread, and exclude true missing-event rows.

## Simpler Alternative

Extend `/api/mirror/ledger` with a `patterns` field and reuse one fetch. This is
less code, but it couples FR-MIR-01 pattern aggregation to the ledger contract
and makes the existing screen/service harder to reason about. A separate
read-only `/api/mirror/patterns` route keeps the ledger stable and lets review
validate the new pattern contract in isolation.

## Assumptions

- Existing annotations use only the shared lowercase outcomes:
  `done`, `moved`, `cancelled`, `late`.
- `events.start` is the correct source for weekday patterning; annotation
  `logged_at` is only the range filter.
- Null/blank event type and absent thread are valid unknown states, not errors.
- `total < 3` is sufficient for Pattern A low-sample labeling, matching the
  existing Mirror A caution style.
- Pattern ratios may be shown as descriptive evidence, but must not drive
  automatic suggestions or hidden mutations.
- Browser manual checks may be recorded as limitation + automated/code evidence
  if the executor is running headless, but the limitation must be explicit.

## Review Guidance

### Enumeration Required

- Mirror shared contracts:
  - Search:
    `rg -n "Mirror.*Schema|Mirror.*Data|Mirror.*Response|MirrorRange|MirrorLedgerQuery" shared/src/mirror.ts shared/src/mirror.test.ts`
  - Expected: ledger schemas still parse old payloads; pattern schemas are new
    and exported through `shared/src/index.ts`.

- Mirror backend boundaries:
  - Search:
    `rg -n "mirror/patterns|buildMirrorPatterns|find.*Pattern|findMovedCancelledAnnotations|registerMirrorRoutes" server/src`
  - Expected: route is thin, repository owns SQL, service owns grouping math.

- Annotation outcome coverage:
  - Search:
    `rg -n "ANNOTATION_OUTCOMES|AnnotationOutcomeSchema|annotations_outcome_check|outcome in" shared/src server/src`
  - Expected: pattern source includes exactly done/moved/cancelled/late and
    does not silently drop done.

- Deterministic / no LLM boundary:
  - Search:
    `rg -n "completeChat|createLlmGateway|LLM_PROXY_BASE_URL|mirror" server/src`
  - Expected: mirror route/service/repository do not import or call the LLM
    gateway.

- Mirror frontend surface:
  - Search:
    `rg -n "MirrorLedger|MirrorPatterns|mirror/patterns|표본|줄여|고쳐|위험|나쁜" web/src`
  - Expected: pattern section exists, recovery states remain, and copy is
    descriptive only.

- Codebase map:
  - Search:
    `rg -n "mirror/patterns|Mirror Pattern|buildMirrorPatterns|MirrorPatterns" docs/codebase-map.md`
  - Expected: docs mention route, service/repository, shared contract, and UI
    surface.

### Verification Method Guide

- Query validation:
  - Shared unit tests are enough for schema parsing.
  - Route-level 400 mapping needs Fastify integration tests.

- SQLite joins, missing event rows, and source outcome enumeration:
  - Mock tests are insufficient.
  - Use real temporary SQLite integration tests.

- Grouping math and sorting:
  - Pure service unit tests are sufficient for normal and edge cases.

- UI states and copy:
  - Vitest/JSDOM tests are sufficient for loading/quiet/live/error/access
    rendering and banned-copy checks.
  - Manual mobile/wide, light/dark, keyboard, 44px, and reduced-motion checks
    are still required or must be explicitly recorded as a limitation with
    concrete automated/code evidence.

- No migration/no writes/no LLM:
  - `corepack pnpm db:generate` should produce no migration change.
  - `rg` boundary checks plus route integration without a gateway are required.
