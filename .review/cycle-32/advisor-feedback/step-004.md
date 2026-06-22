# Step 004 — completion: cycle-32 review-v1 resolved

Cycle: 32
Pass: 2
Files Changed:
- shared/src/slots.ts (personIds optional field)
- shared/src/slots.test.ts (personIds test)
- server/src/services/slotCandidates.ts (gap/continuous in scoreFeasibility, personIds in scorePeople, thread in scoreFriction)
- server/src/services/slotCandidates.test.ts (7 new tests)
- server/src/routes/slots.integration.test.ts (thread friction integration test)
- web/src/Today.tsx (people link)
- web/src/Today.test.tsx (people link test)

## Advisor Verdict
NEEDS_REVIEW (1 note, 2 PASS)

## Advisor Feedback
1. gap_impossible test relies on candidate-level overlap (which generateSlotCandidates filters). Path is narrow but real (pre-existing overlapping events in data can create negative inter-event gaps). Keep test, add comment.
2. `!weekday && !type && !thread` cold_start gate is correct — cold_start only when ALL three signals lack sample.
3. codebase-map.md omission doesn't block correctness. Update before review.

## Sonnet Response
- 적용: comment added to gap_impossible test explaining the production path. codebase-map.md updated.
- 무시: nothing ignored.
