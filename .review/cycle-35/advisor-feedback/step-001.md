# Step 001 — Approach check: cycle-35 watcher-reverse-planning-a

Cycle: 35
Pass: 2
Files Changed: (planned) shared/src/watchers.ts, server/src/services/watcher-reverse-plan.ts, server/src/repositories/watchers.ts, server/src/routes/watchers.ts, server/src/services/watcher-deep-view.ts, server/src/services/watchers.ts, server/src/services/watcher-daily-push.ts, web/src/Watchers.tsx, web/src/styles.css, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. A1 (Map param): keep services pure; pass `taskStatuses?: Map<number,string>` as explicit arg. A2 rejected (threshold-update timing undefined this cycle).
2. Transaction order (tasks→watchers→links→watchers UPDATE) correct. Confirm single `transaction()` wrapper and FK/insert-order satisfied.
3. Walk reverse (index N-1→0); execution-first step = index 0, processed last. `cursor - leadDays - (i===0 ? safetyDays : 0)`. Verify safetyDays not double-applied to target itself.

## Sonnet Response
- 적용 (1): buildWatcherDeepView/evaluateWatcherA/selectDueForPush에 `taskStatuses?: Map<number,string>` 추가. 기존 호출부 변경 없음.
- 적용 (2): 트랜잭션 순서 유지. SQLite db.transaction() 사용.
- 적용 (3): walk loop에서 i===0 체크로 safetyDays 적용. 0-based index 0 = 실행 순서 첫 번째 step.
