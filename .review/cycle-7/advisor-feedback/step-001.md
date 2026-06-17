# Step 001 — Today.tsx manual intake bottom sheet (approach)

Cycle: 7
Pass: 2
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
PASS

## Advisor Feedback
VERDICT: PASS (with one correctness guard on point 2)

**1. Sheet state location**
- Keep in Today.tsx for now: state is local, sibling to existing view/replyState
- Extract `useIntakeSheet` only if: form validation + serialize + submit + reset exceeds ~40 lines
- Lean toward extracting the hook — submit/serialize logic is testable in isolation, Today.tsx stays render-focused

**2. RFC3339 offset — SAFE with correct sign**
- `getTimezoneOffset()` returns minutes-west: KST = -540
- Sign rule: offset sign = `total <= 0 ? '+' : '-'` (note: positive west → "-")
- Build suffix from `Math.abs`: pad HH and MM
- Send parsed local fields as-is + suffix; do NOT call `.toISOString()` (that forces UTC)
- Test boundary: DST-less KST is fine, but verify against a +HH:30 zone if portability matters

**3. Animation**
- Use styles.css (className), not inline — keeps `@media (prefers-reduced-motion: reduce)` cohesive
- Slide-up: `transform: translateY(100%)` → `0`; media query sets `transition: none`
- Also gate focus-trap/backdrop, not just transform

## Sonnet Response
- 적용 (1): Start with state in Today.tsx; extract `useIntakeSheet` hook if serialize/submit/validate/reset logic grows past ~40 lines. Serialize logic kept pure for isolated testing.
- 적용 (2): Use the minutes-west sign rule. Build "+HH:MM"/"-HH:MM" from `Math.abs(getTimezoneOffset())` with zero-padding; never call `.toISOString()`. Send parsed local datetime fields + offset suffix.
- 적용 (3): Animation goes in styles.css via className, not inline. `@media (prefers-reduced-motion: reduce)` sets `transition: none`. Reduced-motion also gates backdrop/focus behavior, not just the transform.
- 무시: none.
