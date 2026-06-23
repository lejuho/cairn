# Ego Graph A Implementation Plan

Branch: feature/cycle-40-ego-graph-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycles 38 and 39 established cross-cutting resources, resource links, thread
highlighting, and resource promotion suggestions. This cycle implements the
first A-slice of FR-XREL-04/05: a request-only, small ego graph centered on one
resource or one person.

The cycle is read-only. It must not create a global graph, force layout, graph
canvas, inferred relations, or automatic mutation. The purpose is a compact
"show me nearby things" view that preserves firmness and reason.

## 입력/출력 명세
- 입력:
  - `GET /api/relations/ego?targetType=<resource|person>&targetId=<positive int>&limit=<5..10 optional>`
  - `targetType`
    - `resource`: center is a `resources` row.
    - `person`: center is a `people` row.
  - `targetId`: existing center id.
  - `limit`: optional max node count including center; default `10`; min `5`, max `10`.
- 출력:
  - 정상:
    - `{ ok: true, data: EgoGraphData }`
    - `EgoGraphData`:
      - `center`: `EgoGraphNode`
      - `nodes`: array of `EgoGraphNode`, max `limit`, includes center once.
      - `edges`: array of `EgoGraphEdge`, only between returned nodes.
      - `truncated`: boolean, true when more eligible neighbors existed.
    - `EgoGraphNode`:
      - `id`: stable graph id string, e.g. `resource:3`, `event:9`.
      - `type`: `resource | person | event | task | thread`
      - `targetId`: backing DB id.
      - `label`: display label.
      - optional `sublabel` and `href`.
    - `EgoGraphEdge`:
      - `from`, `to`: graph id strings.
      - `kind`: `resource_link | source_person | event_people | thread_link`
      - `firmness`: `hard | soft | tentative`
      - optional `reason`
      - optional `relationKind` for `thread_link` (`contains`, `blocks`,
        `feeds`, `competes`, `shares`).
  - 실패:
    - `400 VALIDATION_ERROR` for malformed query/limit/type.
    - `404 NOT_FOUND` when the center resource/person does not exist.
- Resource center graph:
  - Includes the resource center.
  - Includes `sourcePerson` edge when `resources.source_person_id` exists.
  - Includes direct `resource_links` targets: event/task/thread, preserving
    each link's `firmness` and `reason`.
  - Event/task nodes may use parent thread name as `sublabel`; parent thread
    context does not require an extra graph node in A-slice.
- Person center graph:
  - Includes the person center.
  - Includes resources where `resources.source_person_id = person.id`.
  - Includes events attached by `event_people`.
  - Event nodes may use parent thread name as `sublabel`.
  - No profile inference, no sensitive interpretation, no "how to influence"
    framing.

## Key Changes
- Shared:
  - Add `shared/src/relations.ts` with `EgoGraphQuerySchema`,
    `EgoGraphNodeSchema`, `EgoGraphEdgeSchema`, `EgoGraphDataSchema`, and types.
  - Export from `shared/src/index.ts`.
  - Add strict schema tests for target types, limit range, node/edge shape, and
    rejection of injected `score`, `recommendation`, or layout coordinates.
- Backend:
  - Add `server/src/services/ego-graph.ts` as a pure builder. It accepts loaded
    rows and returns capped, deterministic `EgoGraphData`.
  - Add repository reads, likely in `server/src/repositories/relations.ts` or
    tightly scoped additions to existing repositories.
  - Add `server/src/routes/relations.ts` and register it in `server/src/app.ts`.
  - Add SQLite integration tests in `server/src/routes/relations.integration.test.ts`.
  - Update `docs/codebase-map.md` for the route/service/UI boundaries.
- Frontend:
  - Add an on-demand ego-graph bottom sheet on `/threads/:id` from the selected
    resource detail panel. Button copy: `작은 관계 보기`.
  - Add an on-demand ego-graph bottom sheet on `/people/:id`.
  - Fetch only after the user taps. Do not fetch ego graph during ordinary page
    load.
  - Render a compact mobile-first node/edge list or CSS mini-map using semantic
    tokens and firmness styles. No canvas, no SVG force graph, no whole-page
    graph view.
  - Local loading/live/quiet/error states inside the sheet; parent screen stays
    usable on fetch failure.

## Sprint Contract
- 통과 기준:
  - Ego graph is read-only and deterministic.
  - Graph is request-only: no ego fetch on initial Thread or PersonDetail page
    load.
  - `nodes.length <= limit <= 10`; center appears exactly once; edges reference
    only returned nodes.
  - Resource center includes resource links with original firmness/reason.
  - Resource center includes source-person relation when present.
  - Person center includes event_people events and source-person resources.
  - Returned order is deterministic and documented in tests.
  - No relation is inferred by LLM or name matching in this cycle.
  - No graph canvas/SVG force layout, no global graph, and no primary nav tab.
  - UI exposes reason/firmness visually and textually.
  - Touch targets are at least 44px, keyboard focus works, and reduced-motion
    preferences are honored.
  - Parent Thread/PersonDetail screen remains usable on ego fetch failure.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static read-only/backend boundary:
    `rg -n "\\b(insert|update|delete|transaction|onConflict|run\\()\\b|completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/relations.ts server/src/services/ego-graph.ts server/src/repositories/relations.ts server/src/routes/relations.ts`
- 테스트 케이스:
  - Shared unit:
    - query accepts `resource/person` and limit `5..10`.
    - query rejects invalid target type, target id, and out-of-range limit.
    - payload schemas reject score/recommendation/layout coordinate fields.
  - Pure service unit:
    - caps nodes at limit and sets `truncated`.
    - drops edges whose nodes were truncated out.
    - maps firmness to `hard | soft | tentative`.
    - preserves edge reason.
    - keeps stable deterministic ordering.
  - Backend integration:
    - resource center with source person + event/task/thread links returns a
      capped graph with original firmness/reason.
    - person center with event_people events + source resources returns graph.
    - missing resource/person returns `404 NOT_FOUND`.
    - malformed target type/limit returns `400 VALIDATION_ERROR`.
    - route does not write to DB.
  - Frontend:
    - Thread page does not fetch ego graph until `작은 관계 보기` is tapped.
    - Resource ego sheet renders loading/live/error, firmness labels, and reason.
    - PersonDetail does not fetch ego graph until tapped.
    - Person ego sheet renders event/resource neighbors.
    - Fetch failure is scoped to the sheet, not the parent screen.
    - No `svg`/`canvas` is rendered for ego graph in A-slice.
  - 수동:
    - Mobile Chrome light/dark: sheet readable, button reachable, graph/list not
      cramped.
    - Keyboard: open/close, focus stays in sheet, Escape closes.
    - Reduced motion: no required motion for understanding graph state.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- A resource has more than 10 linked targets; graph must cap deterministically
  and mark `truncated=true` without dangling edges.
- A person has both event_people events and source-person resources with the
  same display label; graph ids must stay type-qualified and collision-free.
- A thread_link points between two thread nodes but one thread is truncated out;
  the edge must be dropped rather than referencing a missing node.

## 더 단순한 대안 1개
Show only a flat "related items" list and skip edges. This would be faster, but
it would fail FR-XREL-05 because relation firmness and reason would become
secondary or invisible. The A-slice keeps the visual simple but still models
nodes and edges explicitly.

## Assumptions
- Existing cycle 38/39 `resources`, `resource_links`, and promotion suggestion
  behavior is available on `master`.
- Person relations use existing `event_people` and `resources.source_person_id`.
  No new DB table is needed.
- `thread_links` may be included only when both endpoint nodes are returned.
  A-slice does not attempt broader graph traversal.
- Event/task parent thread can be represented as node `sublabel` in A-slice to
  stay within the 5-10 node cap.
- Ego graph is an on-demand explanatory detail, not a new primary surface.

## Review Guidance
### Enumeration 필요 항목
- New route and registration:
  - Search: `rg -n "relations|ego" server/src/app.ts server/src/routes shared/src web/src`
  - Expected: exactly one read route, registered in `app.ts`, no new primary nav
    route.
- Target types:
  - Search: `rg -n "resource|person|event|task|thread" shared/src/relations.ts server/src/services/ego-graph.ts server/src/routes/relations.ts`
  - Expected center target types: `resource`, `person`; neighbor node types:
    `resource`, `person`, `event`, `task`, `thread`.
- Edge kinds:
  - Search: `rg -n "resource_link|source_person|event_people|thread_link" shared/src/relations.ts server/src/services/ego-graph.ts web/src`
  - Expected: all four edge kinds represented; no vague untyped edge.
- Read-only boundary:
  - Search: `rg -n "\\b(insert|update|delete|transaction|onConflict|run\\()\\b" server/src/services/ego-graph.ts server/src/repositories/relations.ts server/src/routes/relations.ts`
  - Expected: no mutation calls in new ego graph route/service/repository.
- No external/LLM:
  - Search: `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/relations.ts server/src/services/ego-graph.ts server/src/repositories/relations.ts server/src/routes/relations.ts`
  - Expected: no hits in backend/shared files.
- No full graph rendering:
  - Search: `rg -n "<svg|<canvas|force|d3|graphlib|cytoscape|global graph|전체 그래프" web/src`
  - Expected: no graph library, no canvas/SVG force graph, no global graph page.

### 검증 방식 가이드
- Shared schema and pure graph capping/order: unit tests are sufficient.
- DB relation enumeration for resource/person centers: SQLite integration tests
  are required because resource links, source person, and event_people are stored
  across tables.
- Read-only guarantee: static mutation search plus integration row-count checks
  are required.
- UI request-only behavior and scoped failure: Vitest + Testing Library is
  sufficient.
- Mobile/light/dark/reduced-motion/keyboard checks remain manual or must record
  headless limitation plus code/test evidence before merge.
