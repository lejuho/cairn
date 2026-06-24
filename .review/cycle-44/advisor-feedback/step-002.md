# Step 002 — Completion check: Schedule Brief A (cycle-44)

Cycle: 44
Pass: 2
Files Changed: shared/src/events.ts, shared/src/eventDetail.ts, server/src/db/schema.ts, server/drizzle/0004_eager_landau.sql, server/src/repositories/events.ts, server/src/repositories/people.ts, server/src/services/scheduleBrief.ts, server/src/routes/events.ts, web/src/InputHub.tsx, web/src/Today.tsx (+ tests, styles, docs)

## Advisor Verdict
PASS

## Advisor Feedback
1. EventRow.mode — Safe. Every `as EventRow` producer derives from a full drizzle row (.returning().all(), .select().from(events), or $inferSelect), so mode exists at runtime (NULL when unset). insertRawEvent uses .returning(). people.ts maps mode explicitly. No literal-built EventRow omits it.
2. Migration 0004 — Safe. SQL is inline ALTER TABLE ADD COLUMN CHECK. drizzle-kit generate reports "No schema changes" — meta snapshot matches schema.ts, no spurious future diff.
3. findNearestPriorThreadEvent — Offset-safe. Both targetStart and candidate end go through rfc3339ToMs (epoch ms) before compare; NaN guarded; tie-break end desc → id desc. No SQL string compare.
4. hasPeopleFacts — Correct. Guard requires at least one authored field; empty-profile person yields false and does not force the brief open.

## Sonnet Response
- 적용: 1 — 모든 EventRow producer가 drizzle full row 기반, mode 런타임 존재
- 적용: 2 — migration ALTER ADD COLUMN, snapshot 일치(no pending diff)
- 적용: 3 — rfc3339ToMs epoch 비교 offset-safe
- 적용: 4 — hasPeopleFacts 가드로 빈 프로필은 brief 강제 노출 안 함
