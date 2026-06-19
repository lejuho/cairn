# Step 001 — People Directory A approach (backend stats reuse, route, schema placement)

Cycle: 22
Pass: 2
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1) Stats reuse vs generalize queryMeetingStats
- Keep `queryMeetingStats` unchanged — it is on the Decision hot path (findEventPeopleContext). Don't widen its return type.
- Directory: new `findPeopleDirectoryRows()` = `findAllPeople` join + `queryMeetingStats` map merge + `toFrequencyBand`. Reuses both.
- Detail recentMeetings: separate `findRecentMeetings(db, personId, nowIso, limit=10)` — same qualifying filter (status done|confirmed, endMs<nowMs, Number.isFinite), order by endMs desc, slice 10. Don't overload queryMeetingStats to emit rows; one extra small query is cleaner than a dual-shape return.
- Factor the qualifying predicate into one shared helper so the rule lives in one place (avoid two drifting copies of the done|confirmed + epoch filter).

2) Route ordering
- No literal/param collision exists. Fastify uses find-my-way (radix), not array order. `/api/people/directory` and `/api/people/:id/detail` are distinct static-vs-param segments; static wins automatically. Registration order irrelevant. Add `id` integer guard on `/detail` (mirror existing routes).

3) Schema placement
- New file `shared/src/people-directory.ts`; add `export * from "./people-directory.js"` to index. Keeps PersonRow core lean.
- Do NOT re-declare frequencyBand. The enum is duplicated (decision.ts + service literal). Promote one canonical `FrequencyBandSchema` to `shared/src/people.ts`, then decision.ts and the new file import it. Verify decision.ts wasn't relying on inline enum identity before moving.

Regression watch: confirm `FrequencyBand` service type and shared enum stay in sync after promotion; don't break findEventPeopleContext or its tests.

## Sonnet Response
- 적용: (1) Keep queryMeetingStats unchanged; add findPeopleDirectoryRows() + separate findRecentMeetings(); factor qualifying predicate into one shared helper.
- 적용: (2) No route-order change needed (find-my-way radix); add positive-integer id guard on /detail mirroring existing routes.
- 적용: (3) New shared/src/people-directory.ts + index re-export; promote canonical FrequencyBandSchema to shared/src/people.ts and have decision.ts + new file import it instead of duplicating.
- 무시: none.
