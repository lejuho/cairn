# Step 001 — Approach check: Due Task Slot Preview A (slot refactor, eligibility, dismiss, addDays)

Cycle: 62
Pass: 1
Files Changed: (approach only) — planned: schema.ts, drizzle/0007, shared/src/{tasks,slots,today}.ts, server/src/services/slotCandidates.ts, server/src/repositories/tasks.ts, server/src/services/today.ts, server/src/routes/{today,tasks}.ts, web/src/Today.tsx, server/src/utils/rfc3339.ts

## Advisor Verdict
NEEDS_REVIEW (only #4) — applied

## Advisor Feedback
1. PASS — ctx extraction with excludeEventId=null for tasks is correct; task isn't an event row, so no self-exclusion needed. Behavior preserved.
2. PASS — three ref-dates sound; just confirm isCalendarDate + addDays both UTC so todayDate compares cleanly.
3. PASS — no updated_at column means dismissed_on-only write is correct, not an omission.
4. NEEDS_REVIEW — don't inline a duplicate addDays; put it in shared utils (DRY, single UTC impl). Repo→service import is the real smell, util is the fix.
5. PASS — full eligibility → 409 matches due-task-prompt semantics; estMinutes-only would leak previews.

Overall: NEEDS_REVIEW (only #4: extract addDays to utils).

## Sonnet Response
- 적용 (1,2,3,5): ctx 추출(event 경로 불변)/3개 ref-date eligibility/updated_at 없음→dismissed_on만 기록/candidate 라우트 full eligibility 409 그대로 진행. isCalendarDate·addDays 모두 UTC라 todayDate 문자열 비교 일관.
- 적용 (4): addDays를 inline 복제하지 않고 `server/src/utils/rfc3339.ts`로 이동(단일 UTC 구현). slotCandidates.ts는 거기서 import(+테스트 호환 위해 필요 시 re-export), repositories/tasks.ts도 utils에서 import → repo→service 의존 제거.
- 무시: 없음.
