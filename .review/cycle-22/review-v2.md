# Codex Review v2

## Verdict
BLOCKED

## Findings

### ISSUE-5 [LOW] Extracted last-met formatter lacks a time-sensitive unit test
- Location: `web/src/lastMet.ts:8`
- Analysis: the formatter correctly requests hour/minute, but no
  `lastMet.test.ts` exists. The new component assertions only match `/2026/`,
  which the previous date-only implementation also satisfied, and malformed
  input is not asserted. Step Advisor 003 explicitly requested a unit test for
  the extracted helper; the Executor marked that guidance applied without
  adding one.
- Impact: the resolved date/time contract can regress back to date-only while
  all current tests remain green. Advisor-response traceability is also
  incomplete.
- Fix direction: add a focused utility test proving a valid value calls
  `toLocaleString("ko-KR", ...)` with both `hour` and `minute`, plus null and
  malformed fallback cases. Mock the locale formatter/options rather than
  asserting environment-specific punctuation.

## Previous Issue Status

- ISSUE-1: RESOLVED
- ISSUE-2: RESOLVED
- ISSUE-3: RESOLVED in implementation; regression proof incomplete under
  ISSUE-5.
- ISSUE-4: RESOLVED

## Regression Check

No behavioral regression found in directory/detail APIs, relationship
qualification, routes, navigation, Access recovery, or People Guard. Added CSS
uses semantic tokens, provides 44px targets and focus styles, adds wide-layout
enhancement, and disables card animation under reduced motion.

## Sprint Contract Check

- Directory/detail API and SQLite relationship behavior: PASS.
- Mixed offsets, malformed/null timestamps, status exclusions, sorting,
  tie-break, and limit 10: PASS.
- Directory/detail routes and four-link navigation: PASS.
- Loading/quiet/live/error/Access states and retry/navigation interactions:
  PASS.
- Semantic-token styling, 44px targets, wide layout, reduced motion: PASS by
  source verification.
- Last-met date/time implementation: PASS; durable regression test: FAIL
  (ISSUE-5).
- No LLM dependency or migration: PASS.
- Codebase map: PASS.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (`No schema changes, nothing to migrate`)
- `corepack pnpm test:integration`: PASS (12 files, 274 tests)
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - unit tests: PASS (shared 2, server 7, web 171)
  - integration tests: PASS (274)
  - build/PWA asset assertion: PASS
- `git diff --check`: PASS
- Manual mobile/wide/light/dark visual verification: NOT RUN in this review.

## Changes Outside Plan

No unplanned product scope found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only -->

## RESOLVED

### Issue Classification
- ISSUE-5: APPLY

ISSUE-5가 Sprint Contract 회귀 방지 미완성 항목이며 plan.md 범위(last-met date/time contract 검증) 내.

### Applied

RESOLVED: ISSUE-5 — `lastMet.ts` 헬퍼 unit test 추가 (durable regression proof).
- `web/src/lastMet.test.ts` (신규): `vi.spyOn(Date.prototype, "toLocaleString")`으로 locale/options 검증 — `ko-KR` + `hour` + `minute` 옵션 포함 단언. null·malformed fallback 케이스, Z-suffix 처리, `LAST_MET_FALLBACK` 상수 copy 고정.
- `afterEach(() => vi.restoreAllMocks())` + 미사용 `beforeEach` import 제거 (Advisor step-005 hygiene 지적 반영).

자동 체크: verify ✅ / web test ✅ (177 tests, +6) / lint ✅ / typecheck ✅ / build ✅
