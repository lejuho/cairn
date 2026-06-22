# Step 003 — review-v1 fix approach: calendar-date validation hardening

Cycle: 27
Pass: 4
Files Changed: shared/src/mirror.ts, shared/src/mirror.test.ts, server/src/routes/mirror.integration.test.ts (pending)

## Advisor Verdict
PASS

## Advisor Feedback
1. Round-trip mandatory — NaN-check alone insufficient. 2026-02-30, 2026-06-31, 2026-02-29
   all return valid ms (no NaN) but roll over; caught only by round-trip. NaN-check alone
   catches 2026-99-99/2026-13-01/2026-00-10/2026-01-00. Both layers required.
2. .optional() short-circuits correctly. Undefined from/to never hit regex/refine; empty-query
   and single-bound queries pass. Verified by code structure and passing tests.
3. No edge risk from shared schema reuse. IsoCalendarDateSchema is stateless (pure
   isCalendarDate), safe to reuse independently for both fields. Top-level from<=to refine
   unchanged.
Watch item (non-blocking): 0000-01-01 passes (valid ISO round-trip). Out of ISSUE-1 scope;
defer to future cycle if downstream consumer needs a year-floor guard.

## Sonnet Response
- 적용 1: parse-NaN + round-trip 두 계층 모두 사용. isCalendarDate = NaN guard + toISOString().startsWith(value).
- 적용 2: IsoCalendarDateSchema.optional() per field; 기존 from<=to top-level refine 유지.
- 적용 3: 공통 스키마 독립 재사용, edge risk 없음.
- 무시: 0000-01-01 year-floor guard — ISSUE-1 범위 외, DEFER.
