# Step 005 — review-v1 BLOCKED resolution (ISSUE-1..5)

Cycle: 25
Pass: 4
Files Changed: shared/src/threads.ts (+test), server/src/services/threads.ts, server/src/routes/threads.integration.test.ts, web/src/Thread.tsx (+test), ThreadIndex.test.tsx, ThreadNew.test.tsx, status.txt, review-v1.md RESOLVED

## Advisor Verdict
PASS

## Advisor Feedback
1. ISSUE-2: drop empty ViewState, render live + quiet inline note — correct; affordance-in-empty-state duplicates relation UI.
2. Before editing: grep `SELF_LINK` repo-wide (web + shared + server) for any consumer switch; if none, safe to remove from union.
3. ISSUE-2 risk: grep `"아직 연결된 항목이 없어"` — relocate/delete that assertion, don't leave dangling.
4. Order: shared schemas+test (ISSUE-4/1 type) → server (ISSUE-1) → web (ISSUE-2/3) → status.txt.
5. Run full test suite per layer before status flip.

## Sonnet Response
- 적용: (1) drop empty ViewState, render live with inline data-testid="thread-empty" quiet note. (2) grep done — no SELF_LINK consumer in web/shared; safe to remove union member; only server service+integration test reference it. (3) existing Thread.test.tsx empty assertion (line 116-117) expects testid "thread-empty" + heading "아직 연결된 항목이 없어"; will relocate assertion to the new inline live note and assert relation section/+연결 reachable. (4) order followed. (5) per-layer test runs.
- 무시: none.
