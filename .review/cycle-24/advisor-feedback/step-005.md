# Step 005 — ISSUE-1 opener focus restore (ConflictResolvedSheet)

Cycle: 24
Pass: review-v2 resolution (Approach check)
Files Changed: web/src/Today.tsx (+ web/src/Today.test.tsx assertion)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. Standard captured-node-restore is insufficient: refresh() unmounts then remounts, so the captured opener detaches; restoring to it strands focus on body.
2. Decouple restoration from unmount cleanup. Don't restore in the effect cleanup that races refetch.
3. Give each card opener a stable id (e.g. data-conflict-opener or id from task id).
4. In handleCompleteResolved: setConflictSheet({open:false}), `await refresh()`, then query the live re-rendered element by that stable id and `.focus()`.
5. Keep unmount-cleanup restore only as Escape/cancel fallback (no refetch path).
6. Assert against the live element; don't relax the test.

## Sonnet Response
- (Approach check — to be applied during implementation)
- 적용 예정 (1,2): unmount cleanup의 captured-node restore가 refetch 경로에서 detached node에 focus 고립시키는 근본 원인 수용. cleanup restore를 refetch와 decouple.
- 적용 예정 (3,4): card opener에 stable selector(task id 기반) 부여 → handleCompleteResolved에서 await refresh() 후 live element 재조회하여 focus.
- 적용 예정 (5): unmount cleanup restore는 Escape/cancel(refetch 없는 경로) fallback으로만 유지.
- 적용 예정 (6): 테스트는 live element 기준 단언 유지 — relax하지 않음.
- 무시: 없음.
