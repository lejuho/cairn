# Step 001 — approach: scoring pipeline, feasibility temp event, people hard constraint

Cycle: 32
Pass: 1
Files Changed (planned):
- shared/src/slots.ts
- server/src/services/slotCandidates.ts
- server/src/services/slotCandidates.test.ts
- server/src/routes/slots.integration.test.ts
- web/src/Today.tsx
- web/src/Today.test.tsx
- docs/codebase-map.md

## Advisor Verdict
NEEDS_REVIEW (C requires fix)

## Advisor Feedback
- A (pre-fetch + in-memory filter): Safe if rangeStart/rangeEnd spans all windows. Must replicate overlap predicate (event.start < winEnd && event.end > winStart) not date-prefix. ✓ Already planned.
- B (temp event feasibility): Correct — computeEnergy reads start/end/status only. status:"planned" passes filter. Must ensure candidate dateStr is passed to computeDayFeasibility correctly. ✓
- C (hard-unavailable -25 stays visible): Risk — with sort-by-score-desc, a -25 candidate could outrank cold_start neutral candidates. Fix: ensure hard-violation candidate score is floored below any non-violating candidate. Impl: set people lens to -40 on hard-unavailable, and suppress any "preferred" reasonCode.

## Sonnet Response
- 적용: Use -40 (not -25) for hard_unavailable_weekday to ensure violation never outranks non-violation. Suppress person_preferred_window reasonCode when hard constraint violated.
- 무시: 없음.
