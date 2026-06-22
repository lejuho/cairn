# Step 002 — completion: cycle-32 slot scoring pipeline

Cycle: 32
Pass: 1
Files Changed:
- shared/src/slots.ts (extended schemas)
- shared/src/slots.test.ts (new, 17 unit tests)
- server/src/services/slotCandidates.ts (full refactor)
- server/src/services/slotCandidates.test.ts (new, 17 unit tests)
- server/src/routes/slots.integration.test.ts (9 new integration tests)
- web/src/Today.tsx (enriched schedule prompt rendering)
- web/src/Today.test.tsx (SLOT_CANDIDATE enriched + 6 new tests)
- docs/codebase-map.md (updated)

## Advisor Verdict
NEEDS_REVIEW (2 gaps)

## Advisor Feedback
- Concern 1 (pre-fetch + in-memory overlap): SOUND. findEventsInRange uses identical predicate; overlaps() matches DB semantics.
- Concern 2 (hard-unavail can rank first): REAL but acceptable. Math.max(0,...) floors display score to 0; ranking is by raw pre-floor score. Hard-unavail never gets person_preferred_window reasonCode (constraint check precedes preferred check). Sprint contract satisfied: no candidate shown as "preferred" when violating hard constraint.
- Concern 3 (additive friction -25 undocumented): FIXED — codebase-map now documents additive worst-case -25 and score floor behavior.
- Note (threadId unused in scoreFriction): accepted. Thread-based friction scoring is future work (out of cycle-32 scope). ESLint does not flag unused function parameters in this config.

## Sonnet Response
- 적용: codebase-map additive friction penalty + score floor rule documented.
- 무시: threadId removal — kept in signature for future thread friction expansion; ESLint passes.
