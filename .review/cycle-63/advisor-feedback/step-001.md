# Step 001 — Approach check: Task Slot Apply A (FK column, active-block, apply route, ctx echo)

Cycle: 63
Pass: 1
Files Changed: (approach only) — planned: server/src/db/schema.ts, drizzle/0008, shared/src/{tasks,slots}.ts, server/src/repositories/tasks.ts, server/src/routes/tasks.ts, web/src/Today.tsx

## Advisor Verdict
PASS

## Advisor Feedback
1. Yes. SQLite ADD COLUMN allows inline REFERENCES only with NULL default; nullable works. If drizzle-kit rebuilds, drop `.references()`, keep plain integer. Correct.
2. Complete. Confirm `done` SHOULD block-resurface (a completed block likely shouldn't resurface task) — verify against plan intent. Orphan/cancelled/moved resurface: good.
3. Sound, all-or-none. Eligibility-before-already-scheduled order fine. Keep insert+update in one better-sqlite3 sync transaction.
4. Required. Echo server-captured {date,now,days}; fresh wall-clock now causes window drift → false TASK_SLOT_STALE.
5. Good. Use Zod `.strict()` to reject score/apply/taskId; `end>start` refine; days 1..14 default 7.

PASS

## Sonnet Response
- 적용 (1): scheduled_event_id를 `.references(events.id)`로 추가 후 migration 검사 — REBUILD 발생 시 plain nullable integer로 강등(plan의 "no table rebuild" 우선, FK는 read-time active-block 검증으로 대체).
- 적용 (2): plan이 active status를 `planned|confirmed|done`으로 명시 → `done`은 active로 간주(완료된 블록은 task를 prompt에서 계속 제외). cancelled/moved/missing만 resurface. advisor의 "done이 resurface해야 하지 않나" 우려는 plan 명세를 따라 done=active로 확정(plan 본문 직접 인용). 이유: plan scope 고정, mid-cycle 재해석 금지.
- 적용 (3,4,5): 라우트 순서/all-or-none 단일 트랜잭션/프론트 {date,now,days} echo/strict request(end>start, days 1..14, reject score/apply/taskId) 그대로 진행.
- 무시: 없음.
