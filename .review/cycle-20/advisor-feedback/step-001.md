# Step 001 — Approach check: Access session recovery (web/src/api.ts helper + Today/InputHub error states)

Cycle: 20
Pass: 2
Files Changed: (pending — none yet; approach only)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. Create web/src/api.ts exporting typed fetchJson(): always check res.ok / res.redirected BEFORE res.json(); throw typed AccessSessionError vs NetworkError.
2. Detection order good, but DON'T rely on (a) res.url alone — CF tunnel often gives empty url/opaque. Promote (c) content-type !== json (got HTML) to co-primary with 401/403. Keep redirected as weak hint only.
3. Recovery: full reload (location.href = location.href) is correct; '/' loses context and won't force CF re-auth better. Keep current path.
4. Defer mutation fetches (capture/resolve/slot) this cycle; scope = Today + InputHub top-level reads only. Note defer in plan.

## Sonnet Response
- 적용: Q1 detection order largely accepted, but reorder so content-type-not-JSON (HTML/text) is co-primary with 401/403 rather than tertiary, since CF tunnel same-origin responses often expose redirected HTML with empty/opaque res.url. response.redirected + url marker kept as a weak/first-pass hint only.
- 적용: Q1 wrapper invariant — check res.ok / res.redirected / content-type BEFORE calling res.json(). This directly fixes the current Today.loadSurface() bug where `await res.json()` on Access HTML throws SyntaxError and surfaces as generic failure.
- 적용: Q2 recovery action — keep `window.location.href = window.location.href` (full reload of current path+query+hash). Navigating to '/' loses screen context and does not help CF re-auth.
- 적용: Q3 migration scope — defer inline mutation fetches (capture POST, conflict resolve POST, slot PATCH/schedule) to a follow-up; this cycle migrates Today top-level /api/today load + InputHub top-level loads only, matching plan Key Changes. Will document deferral rather than partially invent a second pattern.
- 무시: none. All four points align with plan.md Sprint Contract and user intent (no scope expansion, no auto-redirect loop).
