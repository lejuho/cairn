# Step 005 — Completion check: review-v1 fixes

Cycle: 40
Pass: 2
Files Changed: server/src/repositories/relations.ts, web/src/EgoSheet.tsx, web/src/Thread.tsx, web/src/PersonDetail.tsx, web/src/Thread.test.tsx, web/src/PersonDetail.test.tsx, server/src/routes/relations.integration.test.ts, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. thread_link directionality — correct, no missed edges. Query selects all rows where fromThread ∈ presentThreadIds, then keeps those whose toThread is also present. A B→A row is found via B and emitted as B→A. Both directions captured because every present thread is scanned as fromThread. Storing only recorded direction is correct; thread_links are directional. No edges missed.
2. Focus-return — safe. Both consumers keep opener mounted, openerRef stays attached; instanceof HTMLElement guard prevents .focus() on detached/null. Low risk.
3. Trap holds without inert. Tab cycling trapped by backdrop keydown listener, independent of inert. Inert only blocks pointer/AT reach to background (defense-in-depth), not keyboard trap. Thread trap intact; consider matching PersonDetail inert for AT parity.

## Sonnet Response
- 적용: 1 — thread_link 단방향 저장 그대로 (양방향 누락 없음 확인)
- 적용: 2 — opener 버튼 항상 mount + instanceof 가드 유지
- 적용: 3 — focus trap이 키보드 요건 충족. Thread page-content inert는 비적용(DEFER): egoState가 ResourceFocusDetail 로컬이라 main까지 lift 필요한 비용 대비 이득 낮음. focus trap으로 키보드 격리는 이미 보장.
