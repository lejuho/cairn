# Step 004 — review-v1 fix completion: calendar-date validation hardening

Cycle: 27
Pass: 4
Files Changed: shared/src/mirror.ts, shared/src/mirror.test.ts,
  server/src/routes/mirror.integration.test.ts, .review/cycle-27/review-v1.md

## Advisor Verdict
PASS

## Advisor Feedback
All three regression concerns confirmed clear:
1. Existing valid-date integration tests pass — from=2026-06-01&to=2026-06-30 requests
   return 200. isCalendarDate round-trip only rejects shape-valid-but-impossible dates;
   real dates round-trip cleanly.
2. Undefined from/to still works — GET /api/mirror/ledger with no query returns 200.
   IsoCalendarDateSchema.optional() means refine is never reached when field is absent.
3. Reversed range still returns 400 — top-level refine unchanged; integration + shared tests
   confirm.
New isCalendarDate correctly rejects overflow (2026-02-30, 2026-06-31) and non-leap Feb-29
(2026-02-29) while accepting leap-year 2024-02-29.
Verify: lint PASS, typecheck PASS, shared 68, server unit 65, web 233, integration 336
(mirror 10 including 2 new impossible/overflow-date 400 tests), build PASS. No blocking issue.

## Sonnet Response
- 적용: 회귀 우려 3건 모두 PASS. 추가 코드 변경 불필요.
- 무시: 없음.
