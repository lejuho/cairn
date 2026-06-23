# Step 003 — Approach check: review-v1 fixes (ISSUE-1 ~ ISSUE-4)

Cycle: 35
Pass: 4 (review-v1 fix pass)
Files Changed: (planned)

## Advisor Verdict
PASS

## Advisor Feedback
1. Route calls `computeReversePlan` first inside try/catch; overflow/invalid → 400 VALIDATION_ERROR. Keep repository pure (accepts precomputed plan), so it isn't recomputed. Add `.strict()` to reject unknown keys.
2. Pull `view.steps[view.nextStepIndex].label` for both messages. Guard nextStepIndex bounds (completed plan) to avoid undefined.
3. (A) Repository knows inserted ids; return full `{ watcher, tasks, links, reversePlan }` rows. Avoids extra round-trip and keeps single transaction authoritative.
4. Yes, but prefer existing UNIQUE constraint; pre-insert duplicate link to force failure, assert watcher+tasks rolled back. Snooze: set `snoozedUntil` future, assert excluded from Today and push.

## Sonnet Response
- 적용: 모두 APPLY
