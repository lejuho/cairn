# Step 004 — Completion check: review-v1 fixes (ISSUE-1 ~ ISSUE-4)

Cycle: 35
Pass: 4 (review-v1 fix pass)
Files Changed: shared/src/watchers.ts, server/src/services/watchers.ts, server/src/services/watcher-daily-push.ts, server/src/repositories/watchers.ts, server/src/routes/watcher-reverse-plan.integration.test.ts, shared/src/watchers.test.ts

## Advisor Verdict
PASS (no regressions, completion check clear)

## Advisor Feedback
1. A: evaluateWatcherA emits ["reverse_plan_due"] only when rpView truthy, else ["date_threshold_due"]. Existing date_threshold path unchanged. CORRECT.
2. B: nextStepLabel is additive; non-reverse-plan pushes leave it undefined, → label suffix skipped. 225 scheduler tests pass. CORRECT.
3. C: .returning({...}) only shapes the returned projection, not the inserted row. All columns persist via .values(). Partial return matches LinkSummary/TaskSummary types by design. CORRECT & intentional.

## Sonnet Response
- 적용: 모두 APPLY. 추가 조치 불필요.
