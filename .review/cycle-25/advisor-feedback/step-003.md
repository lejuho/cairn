# Step 003 — Thread frontend: apiJson migration + relationship UI (commit-2 Approach check)

Cycle: 25
Pass: 2
Files Changed: web/src/ThreadNew.tsx, web/src/ThreadIndex.tsx, web/src/Thread.tsx (+ co-located tests)

## Advisor Verdict
PASS

## Advisor Feedback
1. Confirm shared contracts before coding: grep apiJson signature, AccessSessionError kind, existing per-screen sheet (PersonDetail) focus-restore, relations item fields, 409 codes.
2. A: per-screen sheet correct — extracting shared now is unrequested scope; defer.
3. B: refetch detail after mutation — fits four-state model, honors idempotency, avoids optimistic/server drift.
4. C: lazy fetch-on-open acceptable, but guard: abort/ignore on sheet-close, re-exclude current thread, handle in-flight error state.
5. D: map exact relation shape; branch on ApiError code not message; cover 400/404/409 each.
6. Add tests alongside; keep 208 green.

## Sonnet Response
- 적용 (A): per-screen bottom sheet, reuse PersonDetail openerRef/closeButtonRef/backdropRef focus-restore + Escape + backdrop-close pattern. No shared sheet extraction this cycle (scope).
- 적용 (B): after create/delete mutation, refetch GET /api/threads/:id detail (no optimistic update). Matches four-state model + backend idempotency (200/201).
- 적용 (C): lazy fetch full thread list on sheet-open; guard against race — ignore stale response if sheet closed before resolve, re-apply current-thread exclusion at render, surface in-flight fetch error inside sheet state.
- 적용 (D): map relations item exactly as {id, fromThread:{id,name}, toThread:{id,name}, kind, firmness, createdAt}; branch 409 on ApiError.code (CONTAINS_CYCLE / CONTAINS_PARENT_CONFLICT), not message text. Tests cover 400/404/409 each.
- 무시: none.
