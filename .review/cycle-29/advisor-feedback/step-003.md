# Step 003 — Approach check: energy-trends one-sided range cap (review-v1 ISSUE-1)

## Question
Route one-sided range cap fix. Fix at route vs schema; duplicate vs extract helper; test coverage.

## Advisor (Opus) response
- Route-layer cap is correct: schema can't see `today`; service-resolved range is the real boundary.
- Extract a shared helper (e.g. `resolveTrendRange(from,to,today)` → {from,to}) used by both route and service. Avoids 30-day/89-cap drift; single source of truth.
- Apply the 89-day cap on resolved range in route → 400 VALIDATION_ERROR.
- Keep schema's both-present refine too (defense in depth).
- Edge cases to cover:
  - `?from=1900-01-01` only → 400.
  - `?to=2020-01-01` only → passes (from = to−30).
  - both null → passes (default 30d).
  - invalid date string → 400 (schema already).
  - one-sided `from>to`: with only `from`, to=today; if from>today range may be negative — guard `>89` won't fire; add `from>to` → 400.
- Regression risk: ensure helper returns same defaults service currently produces (to=today, from=to−30); snapshot existing trend tests.

## Decision
- ADOPT: route-layer cap, extract shared `resolveTrendRange` helper, keep schema refine as defense-in-depth, add the listed integration tests.
- Note: also handle one-sided `from>to` (negative range) → 400, not just `>89`.
