# Step 002 — Completion check: Operational Soft Remove Controls A (task drop, reuse status route)

Cycle: 81
Pass: 1
Files Changed: web/src/Today.tsx(+test), web/src/Thread.tsx(+test), web/src/styles.css, server/src/routes/today.integration.test.ts, docs/soft-remove-roadmap.md, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
All claims verified against code.
1. Yes — markTaskDropped/Thread drop() send exactly {status:"dropped"}, no extra field, on all 3 surfaces.
2. Yes — no new DELETE/migration for core domains; only pre-existing thread-link delete remains; event cancel + watcher disarm untouched.
3. Yes — droppable only on activeTasks; done/dropped render as history (chip "드롭", no button).
4. Yes — scoped taskDropError/dropError role=alert, cards persist; permanent "드롭" distinct from one-day "오늘 숨기기" (dismissedOn-only); copy "드롭"; never touches scheduled block.
5. No gap; tests present (Today +4, Thread +2, integration +1).
PASS

## Sonnet Response
- 적용: 변경 없음 — 3개 표면(2분/마감 prompt/Thread active) 모두 PATCH status {status:"dropped"}만 전송·core hard-delete/migration 없음(thread-link delete만 유지, event cancel/watcher disarm 불변)·droppable은 active 행에만(done/dropped history엔 버튼 없음, "드롭" chip)·실패는 scoped role=alert(카드 유지)·영구 드롭은 하루 숨기기와 명확 구분·"삭제" 미사용·scheduled block 미접촉 전부 코드/테스트와 정합 확인.
- 무시: 없음.
