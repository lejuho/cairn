# Codex Review v2

## Verdict
BLOCKED

## Findings
### ISSUE-5 [MEDIUM] Ego sheet hides non-center graph edges
- 위치: web/src/EgoSheet.tsx:96, web/src/EgoSheet.tsx:98, server/src/repositories/relations.ts:206
- 분석: v1의 `thread_link` backend gap은 해결되어 resource ego graphs can now return edges between two thread neighbor nodes. However, `EgoSheet` renders only `neighbors.map(...)` and finds at most the edge between `graph.center` and each node. Any edge whose endpoints are both non-center nodes, such as `thread:1 -> thread:2` with `kind: "thread_link"`, is never rendered. The web tests also assert only center-to-neighbor `resource_link` reason/firmness.
- 영향: Violates the Frontend Key Change to render a compact node/edge list and the Sprint Contract that UI exposes edge firmness/reason visually and textually. The API can now return a valid `thread_link`, but the user cannot see that relation or its firmness/relation kind in the sheet.
- 수정 방향: Render an explicit compact edge list for `graph.edges` (or otherwise annotate non-center edges) using node labels, edge kind/relationKind, firmness chip, and optional reason. Add a web test with center resource + two thread nodes + `thread_link` edge and assert the non-center edge is visible.

## Previous Issue Status
- ISSUE-1: RESOLVED
- ISSUE-2: RESOLVED
- ISSUE-3: RESOLVED
- ISSUE-4: RESOLVED

## Regression Check
- New issue introduced while resolving ISSUE-1/ISSUE-3: backend now returns `thread_link` edges, but the frontend display logic still assumes every visible edge connects directly to the center.

## Sprint Contract Check
- Read-only/deterministic ego graph: PASS.
- Request-only fetch: PASS.
- `nodes.length <= limit`, center once, and no dangling edges: PASS.
- Resource center source person and resource links with firmness/reason: PASS for API and center-edge UI.
- Person center event_people and source-person resources: PASS.
- All expected edge kinds represented: PASS in backend/shared route behavior; PARTIAL in UI because non-center `thread_link` edges are hidden.
- No LLM/external/name-matching: PASS.
- No canvas/SVG/force/global graph/nav tab: PASS.
- UI bottom-sheet/accessibility contract: PASS for dialog semantics, `aria-modal`, Escape close, and focus trap evidence.
- UI exposes reason/firmness visually and textually: PARTIAL — center edges are shown; non-center edges are not shown.
- Parent screen usable on fetch failure: PASS.
- Manual mobile/light/dark/reduced-motion checks: NOT RUN in this review pass.

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check master..HEAD`: PASS
- Static read-only/backend boundary search: PASS (no hits)
- Static no full graph rendering search: PASS (no hits)

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-5: APPLY

### Applied

RESOLVED: ISSUE-5 — ego sheet now renders an explicit edge list including non-center edges
- `web/src/EgoSheet.tsx`: restructured the sheet body into two lists.
  - "항목" node list (`data-testid="ego-node"`) is now navigation-only: type label, label (href→link else span), sublabel. The per-node center-edge firmness/reason chip was removed (edges are not node properties).
  - NEW "관계" edge list (`data-testid="ego-edge"`) iterates **all** `graph.edges`, so non-center edges (e.g. `thread:1 → thread:2` with `kind: "thread_link"`) are visible. Each row resolves from/to labels via a `Map<nodeId, node>` built from `graph.nodes` **including the center**, and shows `{fromLabel} → {toLabel}`, a Korean edge-kind label (resource_link=리소스 연결 / source_person=출처 / event_people=참여 / thread_link=스레드 연결), the `relationKind` label for thread_link (포함/차단/연결/경쟁/공유), the firmness chip (`.resource-firmness--*`), and `reason` when present (`data-testid="ego-edge-reason"`).
  - Empty-state guards for both lists ("연결된 항목 없음" / "표시할 관계 없음").
- `web/src/Thread.test.tsx`: scoped existing assertions to `ego-node`/`ego-edge` testids; **added** a test with a center resource + two thread nodes + a `thread_link` edge asserting the non-center edge renders with kind (스레드 연결) + relationKind (연결) + firmness (soft) and both thread labels.
- `web/src/PersonDetail.test.tsx`: scoped assertions to testids; asserts the edge list shows both 출처 (source_person) and 참여 (event_people) relations.
- `docs/codebase-map.md`: updated the EgoSheet entry to describe the node-list/edge-list split.

자동 체크: lint ✅ / typecheck ✅ / test ✅ (shared 234 / server 291 / web 322) / test:integration ✅ (relations 19) / build ✅ / `corepack pnpm verify` EXIT=0 / `git diff --check master..HEAD` clean
