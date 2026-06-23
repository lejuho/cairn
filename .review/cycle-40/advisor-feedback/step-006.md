# Step 006 — Approach check: review-v2 ISSUE-5 fix

Cycle: 40
Pass: 3
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Keep BOTH lists. Node list = navigation (hrefs/labels/sublabels); edge list = relations. Don't collapse — edges reference nodes by id, node <li> carries the only hrefs.
2. REMOVE per-node center-edge firmness/reason chip. Edge list becomes single source of truth for all edges (center + non-center). No redundancy.
3. Build Map<nodeId, node> from graph.nodes INCLUDING center, for from/to label resolution.
4. Edge row: {fromLabel} → {toLabel}, Korean edge-kind label, relationKind label (thread_link only), firmness chip, reason if present.
5. Add empty-state guard for graph.edges.length === 0.
6. Completion check after: verify center label resolves, no stale firmness refs in node rows.

## Sonnet Response
- 적용: 1 — node list + edge list 분리, node row는 navigation 전용
- 적용: 2 — node row의 center-edge firmness/reason 제거, edge list가 단일 출처
- 적용: 3 — center 포함 Map<nodeId,node>로 from/to label 해석
- 적용: 4 — edge row에 kind/relationKind 한국어 라벨 + firmness chip + reason
- 적용: 5 — edges 빈 상태 가드
