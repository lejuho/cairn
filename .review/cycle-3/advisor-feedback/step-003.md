---
step: 003
type: approach
topic: allDayToMidnightRfc3339 fix for ISSUE-1 (review-v1)
---

## Query
Approach check: allDayToMidnightRfc3339 timezone-local offset 형식 변경
- 핵심 판단 1: offset = (targetMidnightLocalMs - utcMs)/60000 DST-safe?
- 핵심 판단 2: z.string().datetime({ offset: true }) +09:00 형식 통과?
- 핵심 판단 3: 테스트 수정 범위 충분한가?

## Response (Advisor)
APPROVE with corrections.
1. Offset calc — reuse findMidnightUtcMs (Intl-based, DST-correct). offset = (targetMidnightLocalMs − utcMs)/60000. DST-safe.
2. Schema — z.string().datetime({ offset: true })는 T00:00:00+09:00 통과. seconds 필드 필수.
3. Tests — 추가 케이스: negative-offset (New_York → -04:00), +00:00 UTC, 분수 offset (Asia/Kolkata +05:30). 기존 UTC prefix 테스트 3개 업데이트.

## Decision
APPLY: 지시 그대로 구현.
- mapping.ts:89 return 라인만 변경 (findMidnightUtcMs 호출은 유지)
- 테스트: 기존 3개 UTC prefix 어서션 수정 + Kolkata/UTC 케이스 추가 + Today all-day route 통합 테스트 추가
