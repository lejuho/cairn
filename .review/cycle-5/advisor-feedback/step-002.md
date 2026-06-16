---
step: 002
type: completion
topic: Today Review Queue (Cycle 5) 구현 완료
---

## Query
Completion check: needs_review 카드 + inline reply
- 우려 1: findNeedsReviewEvents leftJoin 중복 이벤트 반환 가능성
- 우려 2: handleReply useCallback deps replyState — 무한 루프 가능성
- 우려 3: exactOptionalPropertyTypes와 BASE_SURFACE needsReviewEvents:[]

## Response (Advisor)
PASS.
1. leftJoin 중복 없음 — annotation 있는 event는 non-null row로 필터, 없는 event는 단일 null row만.
2. 무한 루프 없음 — setReplyState는 이벤트 핸들러 안에서만, render 중 호출 아님.
3. exactOptionalPropertyTypes 무관 — required field라 optional/undefined 규율 대상 아님. typecheck 통과로 입증.

## Decision
APPLY. 비고(blocker 아님): key 일관성 차이(event.id vs i) — 기능 영향 없음. 다음 cycle에서 정리 가능.
