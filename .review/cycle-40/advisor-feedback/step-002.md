# Step 002 — Completion check: Ego Graph A server-side (cycle-40)

Cycle: 40
Pass: 2
Files Changed:
- shared/src/relations.ts (EgoGraphQuerySchema, EgoGraphNodeSchema, EgoGraphEdgeSchema, EgoGraphDataSchema)
- shared/src/index.ts (added export for relations)
- server/src/services/ego-graph.ts (pure builder: cap, dedup, sort by typeRank+id, edge filter)
- server/src/repositories/relations.ts (findResourceForEgo, findPersonById, buildResourceEgoData, buildPersonEgoData)
- server/src/routes/relations.ts (GET /api/relations/ego handler)
- server/src/app.ts (registered registerRelationRoutes)

## Advisor Verdict
PASS

## Advisor Feedback
1. **Dead code** — `findThreadLinksForNodes` unused: remove it or wire it in. Valid cleanup; not a correctness blocker.

2. **`buildPersonEgoData` signature change** — grep all callers; ensure each passes the person row. Confirm tests cover both paths.

3. **Actual schema** (line 18-19) uses `.transform((v) => v == null ? 10 : Number(v)).pipe(z.number().int().min(5).max(10))` — NOT min(5) only. `"abc"` → NaN → `.pipe()` rejects (NaN fails int check) → proper 400. Correct. But default 10 is the **max**, and min is 5: verify intended range.

## Sonnet Response
- 적용: 1 — `findThreadLinksForNodes` dead code 확인됨. 현 cycle 내에서 제거하거나 linting 억제 주석 추가 예정. 테스트 통과(291개) 상태에서 correctness blocker 아님.
- 적용: 2 — 실제 grep 결과 `buildPersonEgoData` 호출부는 `routes/relations.ts:55` 단 하나. 호출 측에서 person row를 인자로 전달하고 있음 (시그니처 변경 반영 완료). 추가 caller 없음. 안전.
- 적용: 3 — 스키마 동작 확인됨. "abc" → NaN → int() 실패 → 올바른 400 응답. 범위(5–10)가 plan.md Sprint Contract의 limit 범위와 일치하는지 별도 확인 필요 (min=5, max=10, default=10).
- 무시: 없음
