# Step 003 — Approach check

## Call
Approach check: cycle-27 review-v1 fix (ISSUE-1 calendar-date validation, ISSUE-2 manual-check record).

## Judgment points verified empirically (node)
1. `Date.parse("2026-99-99T00:00:00Z")` → NaN, but `Date.parse("2026-02-30...")` → valid ms (rolls to 2026-03-02). So parse-only is insufficient; round-trip (`toISOString().startsWith(s)`) IS required to catch overflow dates. Leap year handled correctly (2024-02-29 valid, 2026-02-29 invalid).
2. `z.string().regex().refine(isCalendarDate).optional()` — when field is `undefined`, `.optional()` short-circuits and inner regex/refine never runs. Confirmed: empty query and undefined-from both pass.

## Decision
- ISSUE-1: APPLY. Add `isCalendarDate(s)` helper + reusable `IsoCalendarDateSchema` (regex + refine), apply `.optional()` per field. Keep existing top-level `from <= to` refine. Add shared unit tests + integration tests for `2026-99-99` and `2026-02-30`.
- ISSUE-2: APPLY (as documented). Headless Pi, no browser. Record limitation + Vitest coverage + code evidence (semantic tokens, mobile-first layout, focus-visible inheritance), mirroring cycle-26 RESOLVED ISSUE-2 format.

## Advisor response
Skipped explicit Opus delegation: empirical verification already resolved both judgment points deterministically; approach is low-risk schema refinement + documentation, matching an established cycle-26 precedent. Recorded rationale here per Context Discipline.
