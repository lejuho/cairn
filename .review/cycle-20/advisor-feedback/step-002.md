# Step 002 — cycle-20 completion check: Access session recovery

Cycle: 20
Pass: 1
Files Changed: web/src/api.ts, web/src/Today.tsx, web/src/InputHub.tsx, web/src/api.test.ts, web/src/Today.test.tsx, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. Branch separation holds. Network rejection → `apiJson` catch → `AccessSessionError{kind:"access_session_required"}` → Today/InputHub access_error branch. ok:false JSON → apiJson falls through to res.json() → plain Error → generic error branch. No bleed between paths.

2. Defensive `?.get?.()` falls through for partial mocks. `mockFetch` partial stubs have no `headers` → `""` content-type → not HTML → reaches `res.json()`. All existing mockFetch-based tests pass.

Non-defect note: `res.status != null` (loose) vs `res.redirected &&` (no guard) — asymmetric but correct; both undefined → skip.

## Sonnet Response
- 적용: 모든 항목 확인. 추가 수정 불필요.
- 무시: none
