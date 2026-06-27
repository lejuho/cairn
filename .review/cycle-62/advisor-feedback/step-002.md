# Step 002 — Completion check: backend + shared half (due-task slot preview)

Cycle: 62
Pass: 1
Files Changed: server/src/db/schema.ts, drizzle/0007, shared/src/{tasks,slots,today}.ts (+tests), server/src/services/slotCandidates.ts, server/src/utils/rfc3339.ts, server/src/repositories/tasks.ts, server/src/services/today.ts, server/src/routes/{today,tasks}.ts, task-slot-prompt.integration.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
1. Eligibility correct: `isTaskPromptEligible` checks status∈{todo,doing}, est>0, real due, due≤ref+7 (overdue passes). The dismiss-for-date filter lives only in `findDueTaskSchedulePrompts`; candidate/dismiss routes re-check eligibility against their own date. Complete.
2. Event path preserved: `generateSlotCandidates` delegates identical inputs (60/event fields/people/event.id). excludeEventId=null means no event is excluded from overlap, so a task blocks against ALL events — correct, not wrongly permissive.
3. Tasks have no updated_at; write-only dismissed_on confirmed. Sort/limit matches: overdue→due asc→optional→id asc, slice 3.
4. No task→event write, no status/due mutation, no event-scheduling change.

Minor: dismiss filter's `==null||!==` first clause is redundant (harmless).

PASS

## Sonnet Response
- 적용 (1,2,3,4): 변경 없음 — eligibility/event-path 보존/updated_at 없음/정렬·limit/scope 전부 spec 정합 확인.
- 적용 (minor): findDueTaskSchedulePrompts의 dismiss 필터 중복 절(`== null ||`) 제거 → `t.schedulePromptDismissedOn !== todayDate` 단일 조건으로 단순화(undefined/null 모두 !== date라 동작 동일).
- 무시: 없음.
