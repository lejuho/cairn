# Step 002 — Completion check: cycle-34 watcher daily push

Cycle: 34
Pass: 2
Files Changed: server/src/services/watcher-daily-push.ts, server/src/repositories/watchers.ts, server/src/jobs/watcher-daily-push.ts, server/src/index.ts, server/scripts/watcher-daily-push.ts, server/package.json, package.json

## Advisor Verdict
NEEDS_REVIEW (2 real bugs found, fixed before commit)

## Advisor Feedback
1. Concern 1 real: markWatchersFired runs outside any try/catch. If it throws, throw propagates uncaught, no log — plan.md's "logged clearly" condition unmet.
2. Concern 2 non-issue (KST, no DST). One-line setInterval comment sufficient.
3. Concern 3 real latent bug: storing UTC `now` but comparing `slice(0,10)` against local `date` breaks same-date idempotency gate near midnight KST → duplicate next run.

## Sonnet Response
- 적용 (1): `markWatchersFired` 호출을 try/catch로 감싸고 console.error 로깅 추가. 메시지 이미 전송 완료 후 markFired 실패이므로 sentCount는 유지.
- 적용 (2): setInterval에 KST/no-DST 주석 추가.
- 적용 (3): `runWatcherDailyPush`에서 `markWatchersFired(db, ids, now)` → `markWatchersFired(db, ids, date)` 변경. `lastFired`에 YYYY-MM-DD local date 저장 → `slice(0,10) === date` 비교 항상 정확.
- 수정 후 407 tests all pass.
