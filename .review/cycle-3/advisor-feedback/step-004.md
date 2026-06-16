---
step: 004
type: completion
topic: allDayToMidnightRfc3339 ISSUE-1 fix
---

## Query
Completion check: mapping.ts + test 업데이트 완료
- 우려 1: DST fold/gap에서 offset math 정확한가?
- 우려 2: EventRowSchema z.string().datetime({ offset: true }) — ms 없는 형식 통과?
- 우려 3: Today startsWith(date) 필터 작동 확인

## Response (Advisor)
PASS.
1. Offset math OK. findMidnightUtcMs 8-iteration DST nudge로 gap/fold 처리. DST-gap 존 테스트(America/Sao_Paulo) 추가 권고.
2. EventRowSchema/zod .datetime() 서버에 없음 — SQLite text column으로 바로 저장. 우려 없음.
3. startsWith 필터 확인 ✅.

## Decision
APPLY. Sao_Paulo DST gap 테스트는 Advisor 권고 사항이나 Sprint Contract 밖 — 이번 cycle DEFER. 다음 cycle plan에 포함 예정.
