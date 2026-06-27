# Step 001 — Approach check: Thread Rollup Paid Cost A (helper factoring, dedup, total, UI)

Cycle: 60
Pass: 1
Files Changed: (approach only) — planned: shared/src/threads.ts, server/src/services/paid-cost.ts (new neutral helper), thread-settlement.ts, thread-rollup.ts, repositories/threads.ts, web/src/Thread.tsx

## Advisor Verdict
NEEDS_REVIEW (points 1, 3) — applied

## Advisor Feedback
1. NEEDS_REVIEW. Importing a pure fn sibling-to-sibling is OK, but paid-cost helpers are now shared by two services — put `aggregate/empty/sumPaidCost` in a neutral module (e.g. `paid-cost.ts`) to avoid rollup→settlement coupling.
2. PASS. Reuse the same `visited` set; keep children[] direct-only and add a one-line comment stating that invariant.
3. NEEDS_REVIEW. Make `total` = `sumPaidCost(direct, contains)` only — never recompute. Verify sum covers all five effort buckets + eventCount + windowCount; add a test asserting total == direct+contains.
4. PASS. Chips/flex-wrap is the right mobile-first call.

## Sonnet Response
- 적용 (1): paid-cost helper(`aggregatePaidCost`/`emptyPaidCost`/`sumPaidCost`)를 중립 모듈 `server/src/services/paid-cost.ts`에 두고 thread-settlement.ts와 thread-rollup.ts가 모두 import. rollup→settlement 결합 제거. plan Key Changes의 "if useful, extract a small pure helper" 충족(위치만 더 중립적). thread-settlement.ts도 helper 사용하도록 수정해 동일 의미 공유.
- 적용 (2): contains는 progress/energy와 동일한 `visited` set 재사용으로 cycle/중복 경로 dedup + CONTAINS_CYCLE_DETECTED warning 유지. children[].paidCost는 의도적으로 direct-only이며 코드에 1줄 주석 명시.
- 적용 (3): total.paidCost = `sumPaidCost(direct, contains)`로만 계산(재집계 금지). sumPaidCost가 eventCount/money/social/windowCount + 5개 effort 버킷 전부 합산. 단위 테스트로 total == direct+contains(버킷별) 단언.
- 적용 (4): card-chip flex-wrap 컴팩트 칩 사용, rollup 테이블 컬럼 확장 안 함(모바일 overflow 회피).
- 무시: 없음.
