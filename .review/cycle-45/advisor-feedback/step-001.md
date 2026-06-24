# Step 001 — Preparation Brief A approach (FR-BRF-04)

Cycle: 45
Pass: 2
Files Changed: (planning, pre-implementation) shared/src/scheduleBrief.ts, server/src/repositories/resources.ts, server/src/services/scheduleBrief.ts, server/src/routes/events.ts

## Advisor Verdict
PASS

## Advisor Feedback
1. Flat-fetch repo + pure group/sort service: correct — mirrors findThreadResourceFocus join, keeps grouping unit-testable.
2. Scope-by-(targetType,targetId) match: sound. Self-exclusion verified at events.ts:69 (findNearestPriorThreadEvent excludes event.id), so event_direct vs previous_event never collide.
3. Narrow enum to event|thread for prep links: OK — task never queried. Define a local targetType narrowing; do not weaken the shared event|task|thread enum.
4. reasonCodes prep_<scope> per distinct scope in scope order: reasonable. Also add a top-level brief_preparations code to ScheduleBrief reasonCodes for parity with the existing brief_* pattern.
5. Group-by-resourceId → one row with two scoped links: confirmed correct.
6. Dedupe links per (resourceId, scope, targetId) before grouping — a resource may have multiple raw rows for the same target. Sort firmness deterministically.
7. Keep buildPreparations pure (no DB); route wires findPreparationLinkData → buildPreparations → buildScheduleBrief param.

## Sonnet Response
- (To be filled by Executor on application.)
