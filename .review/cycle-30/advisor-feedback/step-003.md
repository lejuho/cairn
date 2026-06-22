# Step 003 — approach: ISSUE-1 snooze epoch comparison (review-v1 fix)

Cycle: 30
Pass: 2
Files Changed:
- server/src/services/watchers.ts
- server/src/services/watchers.test.ts
- server/src/routes/watcher-evaluation.integration.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
- NaN → fail-open (watcher surfaces): confirmed correct — silent suppression is dangerous failure mode.
- `Date.parse(now)` NaN guard not needed separately: `snoozedMs > NaN` is already false (fail-open), route validates RFC3339. Precondition documented in comment.
- Tests: 3 unit + 2 integration with mixed offsets (expired-surfaces, future-hidden, invalid-surfaces).

## Sonnet Response
- 적용: 모든 항목 APPLY. epoch ms 비교, NaN fail-open, nowMs pre-loop, 5개 테스트 추가.
- 무시: 없음.
