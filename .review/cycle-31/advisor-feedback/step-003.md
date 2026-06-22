# Step 003 — approach: ISSUE-1 preview UI tests (review-v1 fix)

Cycle: 31
Pass: 2
Files Changed (planned):
- web/src/Today.test.tsx (preview tests)
- .review/cycle-31/review-v1.md (RESOLVED section)
- .review/cycle-31/status.txt

## Advisor Verdict
PASS

## Advisor Feedback
- vi.runAllTimersAsync() correct; handles nested timers/microtasks. advanceTimersByTimeAsync(300) also fine for exact boundary.
- apiJson inside setFeasSettings updater is safe in JSDOM; just await timer flush so promise settles before asserting.
- AbortController exists in JSDOM, no mock needed. Add explicit stale-cancel test (rapid double-change → assert only last POST resolves).

## Sonnet Response
- 적용: runAllTimersAsync, stale-cancel explicit test, no AbortController mock needed.
- 무시: 없음.
