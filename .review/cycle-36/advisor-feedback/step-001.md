# Step 001 — Approach check: cycle-36 manual-exogenous-watchers-a

Cycle: 36
Pass: 2 (first implementation pass)

## Advisor Verdict
PASS

## Advisor Feedback
1. DB migration: pattern matches existing code. Use `WATCHER_OUTCOMES` const array + `enumSqlList()` helper for CHECK constraint. `db:generate` after schema edit.
2. Exclusion: No extra filter needed. `findAllWatchersForEvaluation` / `findWatchersForPush` hard-filter `kind === "A"`, so kind="B" manual B watchers never reach Today/push.
3. Mirror service: pure-service + route-does-IO pattern correct. Use `observed_at` consistently. `.slice(0,10)` date filtering OK for YYYY-MM-DD text.

## Sonnet Response
- 적용: 모두 APPLY
- enumSqlList 헬퍼 사용, observed_at 명명 일관성 유지
