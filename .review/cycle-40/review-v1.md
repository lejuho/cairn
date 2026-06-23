# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] `thread_link` edges are declared but never produced by the route
- 위치: server/src/repositories/relations.ts:80, server/src/repositories/relations.ts:215
- 분석: `EgoGraphEdgeKindSchema` includes `thread_link`, and the plan says `thread_links` may be included when both endpoint nodes are returned. The repository only reads `resource_links`, `resources.source_person_id`, and `event_people`; there is no `threadLinks` import/query, and route integration tests never exercise a `thread_link` output.
- 영향: Violates Review Guidance "all four edge kinds represented" and the Assumptions/Sprint Contract around typed edge preservation. The API can advertise a relation kind that the real route cannot return.
- 수정 방향: Import/query `threadLinks` in the ego relation repository and add edges only when both thread endpoint nodes are present after capping. Add a SQLite integration test that creates a `thread_links` row between returned thread nodes and asserts `kind: "thread_link"` plus `relationKind`; also assert the edge is dropped if either endpoint is truncated out.

### ISSUE-2 [HIGH] Person/Thread ego UI is not a bottom sheet with the required keyboard behavior
- 위치: web/src/Thread.tsx:777, web/src/Thread.tsx:848, web/src/PersonDetail.tsx:332, web/src/PersonDetail.tsx:351
- 분석: Thread renders `EgoSheet` inline under the resource detail, and PersonDetail renders a bare `div data-testid="person-ego-sheet"` inside the page section. The implementation does not use the existing sheet/backdrop patterns, PersonDetail has no dialog role, and neither surface implements focus containment or Escape close handling.
- 영향: Violates the Frontend Key Changes for "on-demand ego-graph bottom sheet" on both pages and the Sprint Contract/manual check for keyboard open/close, focus staying in the sheet, and Escape close.
- 수정 방향: Reuse the existing bottom-sheet/dialog pattern for both surfaces, with `role="dialog"`, accessible label, backdrop or modal semantics consistent with the app, initial focus/return focus, Escape close, and tests or recorded manual evidence for keyboard behavior.

### ISSUE-3 [MEDIUM] Ego graph UI drops edge `reason`
- 위치: web/src/Thread.tsx:792, web/src/PersonDetail.tsx:362
- 분석: The rendered node rows show only `edge.firmness` (`[{edge.firmness}]`). `edge.reason` is preserved in backend/shared data, but it is not displayed in either ego graph sheet.
- 영향: Violates Sprint Contract "UI exposes reason/firmness visually and textually" and the Frontend test-case requirement "Resource ego sheet renders loading/live/error, firmness labels, and reason."
- 수정 방향: Render a compact reason label/copy for edges that have `reason`, and add Thread UI test coverage using an ego graph response that contains a reason. Keep empty reasons omitted.

### ISSUE-4 [LOW] `git diff --check` fails on EOF whitespace
- 위치: server/src/repositories/relations.ts:253
- 분석: `git diff --check master..HEAD` reports `new blank line at EOF`.
- 영향: Violates the Sprint Contract automatic check list and blocks merge even though the fix is mechanical.
- 수정 방향: Remove the extra blank line at EOF and rerun `git diff --check master..HEAD`.

## Sprint Contract Check
- Read-only/deterministic ego graph: PASS for static mutation/external boundary and pure builder ordering.
- Request-only fetch: PASS by implementation shape; ego fetch is triggered from button handlers rather than initial page load.
- `nodes.length <= limit`, center once, and no dangling edges: PASS in service/integration coverage.
- Resource center source person and resource links with firmness/reason: PARTIAL — resource links preserve firmness/reason in data, but UI does not expose reason.
- Person center event_people and source-person resources: PASS for backend route behavior.
- All expected edge kinds represented: FAIL — `thread_link` is schema-only/service-test-only, not produced by repository/route.
- No LLM/external/name-matching: PASS.
- No canvas/SVG/force/global graph/nav tab: PASS by static search.
- UI bottom-sheet/accessibility contract: FAIL — inline panels, missing PersonDetail dialog semantics, no focus containment/Escape evidence.
- Parent screen usable on fetch failure: PASS for scoped error rendering.
- Manual mobile/light/dark/reduced-motion/keyboard checks: NOT COMPLETE; keyboard contract currently fails by code inspection.

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check master..HEAD`: FAIL (`server/src/repositories/relations.ts:253: new blank line at EOF`)
- Static read-only/backend boundary search: PASS (no hits)
- Static no full graph rendering search: PASS (no hits)

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY
- ISSUE-4: APPLY

### Applied

RESOLVED: ISSUE-1 — thread_link edges now produced by resource center
- `server/src/repositories/relations.ts`: after collecting linked thread nodes (`presentThreadIds`), when ≥2 exist, query `thread_links` where `fromThread inArray presentThreadIds` and filter `toThread` into the same set (intra-neighborhood only, no global traversal). Emit `{ kind: "thread_link", firmness, relationKind: kind }`. `buildEgoGraph`'s existing edge filter drops any thread_link whose endpoint is truncated out post-cap.
- `server/src/routes/relations.integration.test.ts`: +2 tests — (a) emits thread_link with `relationKind`/`firmness` between two returned thread nodes; (b) drops thread_link when one thread endpoint is truncated out (limit=5, events fill cap).

RESOLVED: ISSUE-2 — ego UI is now a real bottom sheet with full keyboard behavior
- New shared `web/src/EgoSheet.tsx`: `.sheet-backdrop` + `.bottom-sheet` `role="dialog"` `aria-modal="true"`, initial focus on close button, Tab focus trap, Escape close, focus return to opener on unmount, backdrop-tap close. Reused by both Thread and PersonDetail.
- `web/src/Thread.tsx`: removed inline EgoSheet; imports shared component; open button stays mounted as focus-return target.
- `web/src/PersonDetail.tsx`: removed inline list; renders shared EgoSheet outside the `inert` page-content wrapper; page content goes `inert` while open.
- Tests: +Escape-close + dialog/aria-modal assertions in both Thread.test and PersonDetail.test.

RESOLVED: ISSUE-3 — ego UI now exposes edge reason
- `web/src/EgoSheet.tsx`: each node row shows the connecting edge's firmness chip AND `edge.reason` (`data-testid="ego-edge-reason"`), omitted when empty.
- `web/src/Thread.test.tsx`: asserts both firmness ("hard") and reason ("발표 때 필요") render in the sheet.

RESOLVED: ISSUE-4 — EOF whitespace removed
- `server/src/repositories/relations.ts`: removed trailing blank line at EOF. `git diff --check` clean in working tree.

### Deferred (within ISSUE-2 scope, non-blocking)
- Thread page-content `inert` while ego sheet open: DEFER. `egoState` is local to `ResourceFocusDetail`; lifting it to the `main` element exceeds the issue's intent. Keyboard isolation is already guaranteed by the EgoSheet Tab focus-trap + Escape (the review's stated requirement). `inert` would add only AT/pointer defense-in-depth for the background. PersonDetail already applies `inert`.

자동 체크: lint ✅ / typecheck ✅ / test ✅ (shared 234 / server 291 / web 321) / test:integration ✅ (relations 19) / build ✅ / `corepack pnpm verify` EXIT=0 / `git diff --check` clean
