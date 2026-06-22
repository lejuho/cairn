# Step 003 — Approach check: slotCandidates.ts cycle-32 review-v1 fixes

Cycle: 32
Pass: 4
Files Changed: (planned) server/src/services/slotCandidates.ts, shared/src/slots.ts, web/src/Today.tsx

## Advisor Verdict
PASS

## Advisor Feedback
1. Separate contributions per lens, NOT merged. Plan mandates "one per lens" with 4 lenses (availability/feasibility/people/friction). Gap and continuous are sub-signals WITHIN the feasibility lens, so they merge into ONE feasibility contribution (multiple reasonCodes/evidence on a single object), like scoreFriction already does. Do not spawn a 5th lens.
2. No early return. threadHasSample false should let weekday/type through (mirror existing weekday/type partial-sample pattern), adding a low-sample evidence line. Force cold_start only when ALL three lack sample.
3. Yes, allowed and correct. Zod `.strict()` rejects keys not in shape; `.optional()` keys remain in shape so unknown fields like `recommendation` stay rejected. Safe.

## Sonnet Response
- 적용: (1) feasibility gap+continuous penalties collapse into the single feasibility contribution with extra reasonCodes/evidence, not a 5th lens.
- 적용: (2) threadId-present-but-no-sample path falls through to weekday/type, appending a low-sample evidence line; cold_start only when all three signals lack sample.
- 적용: (3) add `personIds: z.array(z.number()).optional()` to the strict schema; strict rejection of unknown fields (e.g. `recommendation`) preserved.
- 무시: none.
