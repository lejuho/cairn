# Step 002 — Completion check: cycle-35 전체 구현

Cycle: 35
Pass: 2
Files Changed: shared/src/watchers.ts, server/src/services/watcher-reverse-plan.ts (NEW), server/src/repositories/watchers.ts, server/src/services/watcher-deep-view.ts, server/src/services/watchers.ts, server/src/services/watcher-daily-push.ts, server/src/routes/watchers.ts, server/src/routes/today.ts, server/src/jobs/watcher-daily-push.ts, web/src/Watchers.tsx, web/src/styles.css

## Advisor Verdict
PASS (no blocking issues)

## Advisor Feedback
1. A: parseReversePlanRule import additive, 425 tests pass. Verify no top-level side effects.
2. B: targetTaskId in taskStatuses wasteful but harmless; confirm buildReversePlanView never reads it.
3. C: selectDueForPush default new Map() silently suppresses reverse_plan; ensure all real callers (job runner) pass taskStatuses.
4. Confirm new Zod schemas imported/validated at POST boundary.

## Sonnet Response
- (1): watcher-reverse-plan.ts는 pure 함수만 export, top-level 부작용 없음.
- (2): buildReversePlanView는 rule.steps[i].taskId를 taskStatuses.get()에 사용. targetTaskId는 rule에 존재하지만 buildReversePlanView 내부에서 참조 안 함. 안전.
- (3): job runner에서 rpTaskIds 수집 후 findTaskStatusesByIds → selectDueForPush에 전달. 실제 경로 올바름. 통합 테스트에서 검증됨.
- (4): POST /api/watchers/reverse-plan에서 CreateReversePlanWatcherRequestSchema.safeParse(req.body) 사용. ✅
