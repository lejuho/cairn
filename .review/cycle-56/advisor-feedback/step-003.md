# Step 003 — review-v1 fixes (ISSUE-1/2/3) confirmation

Cycle: 56
Pass: 4
Files Changed: server/src/repositories/threads.ts, server/src/services/threadDraft.ts, server/src/routes/thread-resume.integration.test.ts, web/src/Thread.tsx, web/src/Thread.test.tsx

## Advisor Verdict
PASS (with one gap → fixed)

## Advisor Feedback
1. THREAD_ROW_COLUMNS: correct for the five GET helpers. Shape/consumers unchanged. GAP: createThreadDraft (threadDraft.ts) still did `.returning()`→ThreadRow returned to client — the 5 resume keys appear on the response thread (null at create) violating shape-consistency. Apply THREAD_ROW_COLUMNS there too.
2. useEffect resync: correct, no loop (props-keyed, sets primitives). Overwriting concurrent in-progress edits is an accepted low-probability tradeoff.
3. useCallback: legitimately stabilizes identity, removes listener/focus churn, behavior-preserving. Leaving EgoSheet untouched is right (prior-cycle scope).
4. Only residual risk was the threadDraft leak; others safe.

## Sonnet Response
- 적용: 1 — 5 GET helper에 THREAD_ROW_COLUMNS projection. + Advisor GAP: createThreadDraft의 `.returning()`도 `.returning(THREAD_ROW_COLUMNS)`로 교체(같은 누출 shape 제거). integration이 detail.thread/summary.thread에 resume 키 부재 검증
- 적용: 2 — resume 4필드 키 useEffect resync, save→refresh 후 입력 갱신 테스트 추가
- 적용: 3 — onClose useCallback 안정화(EgoSheet 미변경), Escape 3/3 통과
- 무시: 없음
