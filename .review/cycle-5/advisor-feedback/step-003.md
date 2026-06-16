---
step: 003
type: approach
topic: Cycle 3 ISSUE-1 — allDayToMidnightRfc3339 local-offset fix (cross-cycle ref)
---

## Query
Approach check: allDayToMidnightRfc3339 timezone-local offset 형식 변경
- 판단 1: offset = (targetMidnightLocalMs - utcMs)/60000 DST-safe?
- 판단 2: z.string().datetime({ offset: true }) +09:00 형식 통과?
- 판단 3: 테스트 수정 범위 충분한가?

## Response (Advisor)
APPROVE with corrections.
1. Offset calc — findMidnightUtcMs (Intl-based, DST-correct) 재사용. DST-safe.
2. Schema — T00:00:00+09:00 형식 통과. seconds 필드 필수.
3. Tests — 추가 케이스: negative-offset (New_York), +00:00 UTC, 분수 offset (Kolkata). UTC prefix 테스트 3개 업데이트.

## Sonnet Response
NOTE: 이 step 파일은 cycle-3 ISSUE-1 작업 중 호출된 Advisor feedback을 cycle-5
session 추적을 위해 기록. 원본 응답은 `.review/cycle-3/advisor-feedback/step-003.md`에
저장됨. hook의 transcript 200KB 윈도우가 cycle-3 advisor 호출을 cycle-5 카운트에
포함하여 발생한 cross-cycle 추적 불일치.

## Decision
APPLY — 지시 그대로 구현. 상세 내용은 cycle-3 step-003.md 참조.
