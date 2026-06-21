# Step 001 — Approach check: Thread Links A implementation

Cycle: 25
Pass: 2
Files Changed: (none yet — pre-implementation approach check)
Planned files: shared/src/threads.ts, server/src/repositories/threads.ts, server/src/services/thread-links.ts (new), server/src/services/threads.ts, server/src/routes/threads.ts, web/src/Thread.tsx, web/src/ThreadIndex.tsx, web/src/ThreadNew.tsx

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
Approach check — Thread Links A:

**(a) Cycle-detection placement**
- DFS in pure service is fine ONLY if it loads edges via injected repo fn (e.g. `findLinksForThread`), not raw DB.
- N+1 is real: bound DFS by depth/visited-set; load all `contains` edges once into adjacency map, not per-node query.
- Verify direction: contains-cycle must traverse the *same kind* graph; mixed-kind traversal = false positives.

**(b) relationCounts fan-out**
- Reject per-thread `countLinksForThread` in a loop. Use one `GROUP BY thread_id` aggregate over thread_links, map in memory.
- Keep counts shape minimal (incoming/outgoing per kind only if UI needs it).

**(c) Commit-unit / scope**
- Scope creep risk: split. Commit 1 = shared schema + repo + service + routes (backend vertical). Commit 2 = web (3 apiJson + relations UI).
- 8 files + new service + cycle-detection in one commit exceeds coherent unit; bottom-sheet UI is independently reviewable.

**Watch:** delete authorization, 409 contract (shared error code), self-link guard.

## Sonnet Response
- 적용 (a): cycle-detection DFS는 주입된 repo fn(findLinksForThread)으로 edge 로드, raw DB 접근 금지. visited-set + 같은 kind(contains) 그래프만 순회하여 false positive 방지. adjacency 1회 로드로 N+1 회피.
- 적용 (b): relationCounts는 루프 내 countLinksForThread 금지. thread_links에 대한 단일 GROUP BY thread_id 집계 후 in-memory 매핑. counts shape는 UI 필요분(incoming/outgoing)으로 최소화.
- 적용 (c): commit 분리 — Commit 1 backend vertical(shared schema + repo + service + routes), Commit 2 web(apiJson 마이그레이션 3 + relations UI). 한 commit에 8파일+신규 서비스+cycle 검사 묶지 않음.
- 적용 (watch): delete authorization, 409 shared error code 계약, self-link guard 구현 시 반영.
- 무시: 없음. plan.md Summary/Sprint Contract와 충돌 없음 — 모두 정합.
