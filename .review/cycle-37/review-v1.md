# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Diary route allows >90-day ranges when only one bound is provided

- Location: `server/src/routes/mirror.ts:118`
- Analysis: `MirrorDiaryQuerySchema` enforces the 90-day cap only when both
  `from` and `to` are present. The route then defaults missing bounds with
  `from = parsed.data.from ?? dateSubtractDays(today, 29)` and
  `to = parsed.data.to ?? today`, but it never re-validates the resolved range.
  Therefore `GET /api/mirror/diary?from=2020-01-01` can resolve to a multi-year
  range ending at server-local today, and `GET /api/mirror/diary?to=2030-01-01`
  can also exceed the intended cap.
- Impact: Violates the input contract: optional `from`, `to`, max 90-day range,
  and the explicit edge case in the plan: "valid `from` but omitted `to`" must
  default `to=today` and still enforce resolved range <=90 days. It also lets a
  read-only reflection endpoint scan far more annotation history than planned.
- Fix direction: Resolve `{ from, to }` before building the diary, then apply the
  same `from <= to` and `<= 89 day diff` checks to the resolved values. Add
  integration coverage for one-bound queries, at minimum:
  `?from=2020-01-01` returns 400 and a valid recent `?from=<today-29d>` returns
  200. Consider extracting a small shared route helper if mirror endpoints keep
  repeating this pattern.

## Sprint Contract Check

- Diary route validates strict date queries and rejects overflow/reversed/>90d
  ranges: FAIL. Both-bound invalid ranges are covered, but one-bound resolved
  ranges can exceed 90 days; see ISSUE-1.
- Diary route is read-only and deterministic; no DB write, no LLM, no external
  network: PASS.
- Diary service groups existing annotations by `loggedAt` calendar date,
  newest-first, with stable tie-breaks: PASS.
- Missing event/thread context is fail-open without hallucination; orphan rows
  are excluded: PASS.
- `depth` is derived deterministically from existing data only: PASS.
- Payload schemas are strict and reject injected recommendation/action/scoring
  fields: PASS.
- `/mirror` renders diary section in loading/quiet/live/error/access-session
  states without regressing existing Mirror sections: PASS by JSDOM coverage and
  source inspection.
- Diary section uses B-temperature reflection styling, semantic tokens, and
  descriptive/non-judgmental copy: PASS with source evidence.
- `docs/codebase-map.md` is updated: PASS.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- Static boundary check for writes/LLM/GCal/Gmail/Telegram/fetch in
  `server/src/services/mirror-diary.ts` and `server/src/routes/mirror.ts`: PASS,
  no hits with word-boundary mutation search
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 175 PASS
  - server unit tests: 258 PASS
  - web unit tests: 299 PASS
  - shared build: PASS
  - server SQLite integration tests: 456 PASS
  - production build/PWA generation: PASS

## Changes Outside Plan

- `master..HEAD`: no committed scope creep found.
- Worktree note: `docs/cairn-spec.md` has an uncommitted FR-XREL spec addition.
  It is not part of the committed cycle-37 implementation diff and should stay
  separate unless explicitly approved for this cycle.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY

### Applied

RESOLVED: ISSUE-1 — diary route에서 resolved range 재검증 추가

- `server/src/routes/mirror.ts`: from/to default 채운 뒤 `diff=(toMs-fromMs)/86_400_000`, `diff<0||diff>89` → 400 VALIDATION_ERROR 반환. energy-trend 패턴과 동일 메시지/임계값.
- `server/src/routes/mirror-diary.integration.test.ts`: 4개 integration test 추가:
  - `?from=2020-01-01` (one-bound, resolved>90d) → 400
  - `?from=<today-29d>` (one-bound, valid) → 200
  - `?to=2020-01-01` (reversed one-bound, diff<0) → 400
  - both-bound diff=89 (경계값) → 200
- Advisor note (무시): reversed range 시 "must not exceed 90 days" 메시지가 약간 부정확하나, energy-trend 기존 패턴과 동일하므로 ISSUE-1 범위 내 변경 불필요.

자동 체크: verify ✅ (175+258+299 unit, 460 integration)
