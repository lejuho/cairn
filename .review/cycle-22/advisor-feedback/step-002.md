# Step 002 — Completion check: People Guard A directory/detail — shared qualifying predicate, route ordering, detail data consistency

Cycle: 22
Pass: 2
Files Changed: server/src/repositories/people.ts, server/src/routes/people.ts, shared/src/people-directory.ts, shared/src/decision.ts, shared/src/people.ts, web/src/PeopleDirectory.tsx, web/src/PersonDetail.tsx, web/src/App.tsx, web/src/AppNav.tsx, server/src/routes/people.integration.test.ts, web/src/App.test.tsx, web/src/PeopleDirectory.test.tsx, web/src/PersonDetail.test.tsx, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
All three concerns verified against actual code. Supplied facts match implementation exactly.

1. CONCERN 1 — Shared predicate gates both paths. CONFIRMED. `isQualifyingMeet` (people.ts:9) is the single predicate. `queryMeetingStats` filters with it (line 71); `findRecentMeetings` filters with the same (line 267). Both derive `nowMs = Date.parse(nowIso)` from the same `now` arg. `lastMet` via epoch-max reduce (line 77); directory sort by epoch desc, nulls-last (247-256). Sound.

2. CONCERN 2 — Route shadowing. CONFIRMED non-issue. Fastify/find-my-way radix tree prioritizes static segments over parametric regardless of registration order; `/api/people/directory` (static) always beats `/api/people/:id/detail`. "directory" never reaches the detail handler. Sound.

3. CONCERN 3 — Detail stats vs recentMeetings consistency. CONFIRMED. Detail (routes/people.ts:37) reuses `findPeopleDirectoryRows(db, now).find(id)` for stats and `findRecentMeetings(db, id, now)` (line 42) for the list, both funneling through `isQualifyingMeet` with identical `now` from `PersonDetailQuerySchema`. No divergence. Sound.

Edge: malformed `nowIso` → `Date.parse`=NaN → `endMs < NaN` is false for all → empty stats/meetings, no throw (`Number.isFinite` + comparison guards). Detail recomputes all rows O(n) — inefficient but correct.

Non-blocking observation: directory `totalMeets` (unbounded count from `queryMeetingStats`) and `recentMeetings` length (capped at limit=10) diverge for people with >10 qualifying meetings. Intended (count vs capped list), not a bug.

VERDICT: PASS

## Sonnet Response
- 적용: 없음 (코드 변경 불필요). 3개 회귀 우려 모두 PASS로 확인됨.
- 무시: totalMeets(무제한) vs recentMeetings(limit 10) 발산 관찰 — 의도된 설계이며 plan.md FR-PPL-02와 정합. 변경하면 spec 위반이므로 무시.
- 무시: detail endpoint O(n) 전체 directory 재계산 후 .find — 본 cycle correctness 범위이고 데이터셋 규모상 무시 가능. 성능 최적화는 별도 cycle 대상.
