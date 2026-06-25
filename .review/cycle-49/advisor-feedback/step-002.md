# Step 002 — Mirror Transition Friction A (FR-MIR-09): read-only GET /api/mirror/transition-friction + Mirror "전환 마찰" UI

Cycle: 49
Pass: 2
Files Changed:
- shared/src/mirror.ts
- server/src/repositories/events.ts
- server/src/repositories/mirror.ts
- server/src/services/mirror-transition-friction.ts
- server/src/routes/mirror.ts
- web/src/MirrorLedger.tsx
- docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. Cross-day leakage: PASS. `computeTransitionCosts(dayEvents, threadLinks)` pairs only consecutive events in the per-day slice (loop `i..i+1` over `scheduled`); thread_links is a lookup table, not a pairing source. No second classifier; reuses cycle-41.
2. !hasFriction in isEmpty: PASS. Pure OR-of-empties; only flips quiet→live when activeDays>0, mirrors other has* guards. Render guard `activeDays>0` matches.
3. status 'done' included: PASS for retrospective intent (energy-trends use planned|confirmed because forward-looking). findScheduledEventsForFriction is new/dedicated; no other consumer affected.
4. low_sample: PASS. Per-day = transitionPairs===0 (deterministic); overall = activeDays<3. Independent, consistent, pure.
5. Scope: PASS. Read-only, no score/coefficient/recommendation; schemas .strict() reject banned fields.

Note (non-blocking): `same_thread` pairs yield costLevel "none" and are excluded from low/high/unknown, so `lowTransitionPairs+highTransitionPairs+unknownTransitionPairs !== transitionPairs` when sameThreadPairs>0. This is intentional (same-thread tracked separately via sameThreadPairs) and the schema imposes no sum invariant — confirm tests assert this split rather than a totaling relationship.

Verdict: PASS

## Sonnet Response
- 적용: Advisor confirmed all 5 regression concerns PASS; no changes required.
- 적용 (non-blocking note): same_thread → costLevel "none" exclusion from low/high/unknown is intentional; sameThreadPairs tracked separately and schema imposes no sum invariant. Verified: `mirror-transition-friction.test.ts` "same-thread consecutive events classify as same/none" already asserts the per-relation split (`sameThreadPairs=1` with `lowTransitionPairs=0`/`highTransitionPairs=0`), not a totaling relationship. No change needed.
- 무시: 없음.
