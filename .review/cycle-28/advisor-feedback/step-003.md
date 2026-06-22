# Step 003 — approach: review-v1 fix (overflow eventStart + manual checks)

Cycle: 28
Pass: 3 (review-v1 fix)
Files Changed: (pending — pre-implementation check)

## Advisor Verdict
PASS

## Advisor Feedback
1. Import isCalendarDate from @cairn/shared (not inline). mirror-ledger.ts already
   does runtime value import from shared; dependency exists and is established.
   Inlining duplicates the exact round-trip logic and risks drift from the
   canonical guard. Single source of truth.
2. In weekdayFromStart(): keep null guard first, then after slice:
   `if (!isCalendarDate(datePart)) return "unknown";` before computing getUTCDay().
3. Unit tests sufficient for "2026-02-30"/"2026-06-31" → unknown. Grouping math
   is the unit layer's job per plan. Skip integration test — no new wiring path,
   would just re-test the pure function.

## Sonnet Response
- 적용 1: isCalendarDate @cairn/shared에서 import.
- 적용 2: weekdayFromStart()에 round-trip guard 추가.
- 적용 3: unit tests만 추가, integration 테스트 추가 안 함.
- 무시: 없음.
