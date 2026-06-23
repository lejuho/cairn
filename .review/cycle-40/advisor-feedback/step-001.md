# Step 001 — Approach check: Ego Graph A (cycle-40)

Cycle: 40
Pass: 1
Files Changed: (pre-implementation — no files changed yet)

## Advisor Verdict
PASS

## Advisor Feedback
**1. Service ordering / tie-break (cap neighbors)**
- Always place center first; it's exempt from the cap.
- Order neighbors deterministically by `(typeRank, targetId asc)`, where typeRank is a fixed enum order: e.g. source_person → resource → event → task → thread.
- Keep first `limit-1` neighbors; set `truncated=true` if any dropped.
- After capping, filter edges: drop any edge whose `from`/`to` graph id is not in the kept set (handles thread_link both-endpoints-out case).
- Ties impossible since `(type,id)` is unique per graph id.

**2. Repository queries (no N+1)**
- Resource center: ~3 — (a) resource + its source_person (one join), (b) all resource_links rows for resourceId, (c) one batched lookup per neighbor target table (events, tasks, threads) using `IN (ids)` + thread-name join for sublabel. Realistically 3-4.
- Person center: ~3 — (a) person, (b) resources where source_person_id=id, (c) events via event_people join (`IN`), with thread-name join. Use `inArray`, never per-row queries. Total well under cap; ≤4 each path.

**3. Button placement**
- Correct to put `작은 관계 보기` inside `ResourceFocusDetail` (Thread.tsx:752). It's the expanded panel for one selected resource — exactly the ego center. The chip list (`ResourceFocusSection`) has no single active center, so a button there would be ambiguous. Gate on `item != null` (already guaranteed). The sheet opens on tap, fetching `targetType=resource&targetId=item.resource.id`.

Key files: `web/src/Thread.tsx` (645-774), `server/src/db/schema.ts` (resources 242, resourceLinks 257, eventPeople 186, threadLinks 157). Note: no `relations.ts` repository exists yet — it's a new file per plan.

One caution: plan's static-boundary check greps for `run(` and `fetch(` in `relations.ts`; the repository must use Drizzle query builder reads (`.select().from()`, `inArray`) not raw `.run()`, to pass the read-only boundary check.

## Sonnet Response
- 적용: 1 — typeRank 기반 결정론적 정렬 후 limit-1 keep, 잘린 노드 관련 edge 필터 적용
- 적용: 2 — resource/person center 각각 ≤4 쿼리, inArray로 N+1 방지
- 적용: 3 — 버튼을 ResourceFocusDetail 내부에 배치, ResourceFocusSection에는 추가하지 않음
- 적용: 주의사항 — relations.ts에서 raw .run() 대신 Drizzle .select().from() + inArray 사용
