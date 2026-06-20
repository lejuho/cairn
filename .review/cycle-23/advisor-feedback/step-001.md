# Step 001 — Approach check: cycle-23 People Profile B (projection unification, contradiction check order, editor prefill)

Cycle: 23
Pass: 2
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. PersonRow projection unification: unify SELECT col set + single mapPersonRow(row) mapper for full-column reads (findAllPeople/findPersonById/findPeopleDirectoryRows). Join sites (findEventWithPeople/findPeopleByIds/replaceEventPeople) currently omit hardConstraints — expanding contract must be verified against EventPeopleResponse consumers. Mapper input: aliased row with preferredWindowsJson/leadTimeJson/hardConstraintsJson.

2. Contradiction check ordering: normalize first (dedup + canonical order) → check overlap → write. Overlap is set-membership invariant under normalization; this order avoids duplicate-driven false results and persists one canonical form.

3. Editor prefill: derive initial sheet state from server PersonRow (preferredWindows.weekdays/periods → preferred day/period toggles; hardConstraints.weekday_unavailable → unavailableWeekday toggles). Mutual exclusion in component state is correct UX. Server must still reject overlap regardless.

## Sonnet Response
- 적용: (1) mapPersonRow helper는 full-projection 3개 함수만 통합. join 경로는 별도 처리. EventPeopleResponse가 PersonRow로 확장되는지 확인 후 결정.
- 적용: (2) normalize → check → write 순서 확정.
- 적용: (3) 초기 prefill은 서버 PersonRow에서 파생. client state mutual exclusion + server validation 이중 보장.
