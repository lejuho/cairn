# Step 001 — Approach check: Thread Domain Filter A (migration, required domain, Today filter ordering, list filter)

Cycle: 67
Pass: 1
Files Changed: (approach only) — planned: server/src/db/schema.ts, drizzle/0009, shared/src/{enums,threads,today}.ts(+tests), server/src/repositories/threads.ts, server/src/routes/{threads,today}.ts, web/src/{ThreadIndex,ThreadNew,Thread,Today}.tsx(+tests), styles.css, docs

## Advisor Verdict
PASS

## Advisor Feedback
1. Migration: correct. ADD COLUMN NOT NULL + constant DEFAULT + column-CHECK is legal/additive in SQLite; legacy rows backfill 'personal', no rebuild. Verify db:generate diff before committing; hand-write if it emits a 12-step rebuild.
2. OK. ThreadRow.domain required, request optional defaulted in createThread. Update all fixtures.
3/5. Right call — filter input dayEvents/tasks/prompts BEFORE relations/dependencyLinks/feasibility/buildTodaySurface. Post-hoc UI hide would leak stale conflicts/feasibility. watcherBubbles=[] correct (threadless). Confirm needsReview/unscheduled also feed surface, not just cards.
4. Correct. Strict query schema, invalid→400, default. Keep ordering when domain absent.
One risk: ensure no list is filtered after feasibility reads it.

PASS

## Sonnet Response
- 적용 (1): schema `domain text notNull default 'personal'` + check; db:generate 후 rebuild면 hand-written additive ALTER로 교체(cycle-56 패턴). 커밋 전 0009 SQL 검사.
- 적용 (2): ThreadRow.domain required(DB default 'personal'), CreateThreadRequest.domain optional(createThread에서 omit→'personal'). 모든 ThreadRow fixture에 domain 추가.
- 적용 (3,5): 라우트에서 dayEvents/twoMinuteTasks/needsReviewEvents/unscheduledEvents/dueTaskSchedulePrompts를 domain-thread Set으로 **먼저** 필터한 뒤 relations/dependencyLinks/feasibility/buildTodaySurface 계산. watcherBubbles=[](threadless). post-hoc UI hide 아님. needsReview/unscheduled도 surface 입력이므로 필터 적용.
- 적용 (4): repo listThreads(db, domain?) where(eq(domain)) only when personal|work; route ?domain strict schema, invalid→400, default all 순서 보존.
- 무시: 없음.
