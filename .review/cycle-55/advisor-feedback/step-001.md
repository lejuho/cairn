# Step 001 — Approach review: Thread STAR Draft A (cycle-55)

Cycle: 55
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Split correct. LLM emits narrative only; service forces confidence="draft" + reasonCodes deterministically; defensive full-schema validate after assembly. reasonCodes must NOT be LLM-chosen — invariant claims. Keep.
2. Sound. Pass settlement.moneyStatus='unavailable' + null money into prompt + SYSTEM_PROMPT ban on fabricated money. Suggestions excluded from facts. Add an explicit warning when moneyStatus unavailable so Result can't claim money.
3. Correct, mirrors cycle-51. Verify 502/503 + 409 THREAD_NOT_DONE; register only inside if(gateway); zero writes on all paths.
4. Minimal/correct. inArray over direct event ids only; guard empty array (skip query → []) to avoid empty-IN SQL.
5. Confirm no migration/insert/update/delete/new column. Risk: static scan may flag persistence verbs in strings/comments — keep identifiers neutral; ensure parser/prompt strings don't contain persistence verbs.

## Sonnet Response
- 적용: 1 — parser는 narrative subset 검증, service가 confidence/reasonCodes 강제 후 full ThreadStarDraftSchema로 방어적 검증
- 적용: 2 — evidence는 service가 결정론적으로 구성, settlement avoided-money unavailable을 프롬프트에 전달 + 금액 날조 금지, missing-node suggestion은 fact로 미전달. moneyStatus unavailable warning 추가
- 적용: 3 — not_found→404, not_done→409 THREAD_NOT_DONE, gateway→503, parse/schema→502; if(gateway)에서만 등록; 전 경로 무write
- 적용: 4 — findAnnotationsByEventIds(inArray, direct event ids만), 빈 배열 가드
- 적용: 5 — migration/insert/update/delete/새 컬럼 없음; prompt/주석에 persistence 동사 회피로 scan 정합
- 무시: 없음
