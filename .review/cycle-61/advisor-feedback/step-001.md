# Step 001 — Approach check: Dismissible Schedule Prompts A (schema, eligibility, filter, dismiss date)

Cycle: 61
Pass: 1
Files Changed: (approach only) — planned: server/src/db/schema.ts, server/drizzle/0006_*.sql, shared/src/events.ts, server/src/repositories/events.ts, server/src/routes/{today,events}.ts, web/src/Today.tsx

## Advisor Verdict
PASS

## Advisor Feedback
1. Optional+nullable OK to avoid 28-fixture churn, but it hides backend drift (a row missing the column passes silently). Prefer required-nullable only if your DB read always projects the column. Compromise: keep optional in EventRowSchema, but assert presence in the dismiss/today response tests so the contract is pinned somewhere. Acceptable.
2. Sound. findById→404 then guarded UPDATE bool→false⇒409 cleanly separates existence from eligibility, and re-dismiss stays idempotent since guard predicates (start/end null, status planned) remain true. Confirm 409 path also fires when status≠planned/already scheduled.
3. Correct. `or(isNull, ne(col,date))` excludes only matching date; reappears later. NULL handled by isNull. Good.
4. Agree. surface.date (query date), not wall-clock — preserves midnight determinism. Correct.
5. Safe — `.set` only touches the two columns; Drizzle won't mutate unlisted fields. Add a test asserting start/end/status/source/self_imposed unchanged post-dismiss.
Add: migration 0006 idempotency/ordering check + index consideration on the filter column if today-query is hot (optional).

PASS

## Sonnet Response
- 적용 (1): EventRowSchema에 `schedulePromptDismissedOn: z.string().nullable().optional()` (28개 fixture churn 회피). 계약은 integration 테스트(dismiss 후 DB 값 + 재조회)와 schema 테스트로 고정.
- 적용 (2): findEventById→404, guarded UPDATE bool→false⇒409. status≠planned/이미 scheduled(start/end non-null) 케이스에 대해 409 + no-write 테스트 추가.
- 적용 (3,4): findUnscheduledCairnEvents(db,date) `or(isNull, ne(col,date))`; 프론트는 `surface.date`(쿼리 날짜) 전송.
- 적용 (5): dismiss 후 start/end/status/source/self_imposed 불변 단언 테스트 추가.
- 무시(부분): hot-query 인덱스 추가는 보류 — Pi-local 소규모 데이터셋이고 별도 인덱스는 추가 migration scope. plan은 단일 컬럼 추가만 명시. (이유: scope 최소화.)
