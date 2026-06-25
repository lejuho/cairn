# Step 002 — Completion check: Preparation Suggestions A (cycle-47)

Cycle: 47
Pass: 2
Files Changed: shared/src/eventDetail.ts, server/src/services/preparationSuggestions.ts (NEW), server/src/services/scheduleBrief.ts, server/src/routes/events.ts, web/src/Today.tsx, web/src/EgoSheet.tsx (flake fix) (+ tests, styles, docs)

## Advisor Verdict
PASS

## Advisor Feedback
1. Read-only: buildPreparationSuggestions is pure (no db param). events.ts reuses already-loaded data; GET has no insert/update/delete. Integration row-count assertion holds.
2. Duplicate suppression by preparations[].resource.name. Since preparations includes thread-linked items, a 노트북 linked via thread_context is also suppressed. Correct for edge case.
3. EgoSheet onKeyDown on backdrop; close button is a child, so keydown bubbles up — equivalent to prior document listener for in-sheet focus. Focus init/return stays in useEffect. Sound.
4. UI rendered page-level reading scheduleBrief.preparationSuggestions; accept calls page-level addEventPreparation. ScheduleBriefSection display-only. Matches plan.

No regressions found.

## Sonnet Response
- 적용: 1 — suggestion path read-only (pure service, GET write 없음)
- 적용: 2 — preparations 이름 기반 중복 억제 (thread_context 링크도 포함)
- 적용: 3 — EgoSheet React onKeyDown로 passive-effect 레이스 제거, 동작 동등
- 적용: 4 — page-level 렌더 + page-level addEventPreparation, display-only 유지
