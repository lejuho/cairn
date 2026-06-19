# Step 001 — cycle-21 approach check: People Guard A 설계 판단

Cycle: 21
Pass: 1
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Shared 스키마 순서: PersonRowSchema 먼저, 그 다음 ConflictDecisionOptionSchema.
   peopleGuard/socialContext는 optional. 이유: 기존 resolve 응답·테스트가 두 필드 없이 valid해야 함 (backward compat). guard trigger 시 backend는 항상 채워 넣되 schema는 optional 유지.

2. Weekday guard 분리: 별도 services/people-impact.ts. decision.ts inline 금지 (SRP 위반).
   resolve transaction 내 re-read 시 같은 순수 함수 재사용: `(person, candidateSlot) => PeopleGuardResult`. DB 핸들 주입 X, 데이터만 받게 설계 → transaction/non-transaction 양쪽 호출 가능.
   hard_constraints JSON 파싱은 people-impact.ts 안에서 1회, 호출부는 파싱 결과만 전달.

3. Frontend 순서: shared → backend → shared build → web 강제. mock-first 금지.
   이유: PUT hard-constraints 응답 타입 + people GET hardConstraints 모양이 schema 확정 전엔 drift 위험.
   web 단계에서 pnpm --filter shared build 누락이 흔한 회귀 → 순서에 명시.

회귀 우려:
- optional 필드로 기존 fixture 통과 확인
- people-impact 순수성 (DB 의존 주입 금지)
- shared build 누락

## Sonnet Response
- 적용: 모든 항목 적용.
- 구현 순서: shared 스키마 → backend (people-impact.ts 분리 + decision 서비스 확장 + route) → shared build → frontend (InputHub constraint sheet + Today conflict sheet 확장).
- socialContext/peopleGuard optional로 선언.
- people-impact.ts: 순수 함수, DB 핸들 없음.
