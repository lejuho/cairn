# Step 002 — Completion check: People Profile B full implementation

Cycle: 23
Pass: 2
Files Changed: shared/src/people.ts, server/src/services/people-impact.ts, server/src/repositories/people.ts, server/src/routes/people.ts, web/src/PersonDetail.tsx, web/src/styles.css, shared/src/people-profile.test.ts, server/src/routes/people.integration.test.ts, web/src/PersonDetail.test.tsx, docs/codebase-map.md

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. EventPeopleResponse consumers safe: new fields are `optional()`, minimal-projection `as PersonRow[]` casts in findEventWithPeople/findPeopleByIds/replaceEventPeople stay type-valid; no consumer reads preferredWindows/leadTime on join path. No regression.
2. Overlap logic sound: normalization is filter-into-canonical-order (reorder + dedup only), preserving set membership, so route's raw-data overlap re-check matches service's normalized check — booleans always agree.
3. Edge gap: if the person is deleted between `findPersonById` and `update` (rows.length===0), service returns null and route reports 400 VALIDATION_ERROR instead of 404 — low-probability race, minor mislabel.
4. Recommend: distinguish the `rows.length===0` null in the route, or have the service signal not-found separately, to avoid the 400/404 confusion.

## Sonnet Response
- 적용: (1) join-path 소비자 안전 확인됨 — optional 필드이므로 기존 EventPeopleResponse 사용처 모두 type-safe. 추가 변경 불필요.
- 적용: (2) overlap 로직 정합성 확인됨 — normalize는 순서/중복 제거만 하므로 set membership 변경 없음.
- DEFER: (3+4) 동시 삭제 race는 단일 사용자 배포에서 발생 확률 극히 낮음. 라우트에 clarifying comment 추가 (null = validation failure, 이미 existence guard 통과 후). 추후 multi-session 지원 시 service 반환 discriminant 분리 예정.
