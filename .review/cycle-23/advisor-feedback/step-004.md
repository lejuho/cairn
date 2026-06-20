# Step 004 — Approach check: review-v2 fixes (ISSUE-3 join projection, ISSUE-5 inert boundary)

Cycle: 23
Pass: 4
Files Changed: (pre-implementation — approach only)

## Advisor Verdict
PASS

## Advisor Feedback
1. ISSUE-3 safe: select projection targets only joined people table; manual aliases (hardConstraintsJson etc.) mean no Drizzle collision. Proceed.
2. Switch all three repo fns: PERSON_COLS + mapPersonRow → return PersonRow[].
3. Update EventPeopleResponseSchema.people → z.array(PersonRowSchema).
4. Delete now-unused EventPersonRow/EventPersonRowSchema; grep for stray refs first.
5. ISSUE-5: use inert on non-sheet content, not portal — keeps sheet in tree for focus/scroll context; inert is the correct isolation boundary.
6. Guard inert with sheet-open state; verify React 19 boolean prop renders attribute.
7. Run typecheck + tests.

## Sonnet Response
- 적용: 1 — ISSUE-3 join-path switch to PERSON_COLS/mapPersonRow confirmed safe; aliasing aliases are manual so no Drizzle collision.
- 적용: 2 — findEventWithPeople, replaceEventPeople, findPeopleByIds 모두 PERSON_COLS + mapPersonRow로 전환, 반환 타입 PersonRow[].
- 적용: 3 — EventPeopleResponseSchema.people을 z.array(PersonRowSchema)로 변경.
- 적용: 4 — EventPersonRow/EventPersonRowSchema 삭제 전 stray refs grep 먼저.
- 적용: 5 — ISSUE-5는 portal이 아닌 inert div로 page content 격리. sheet 트리 내 유지로 focus/scroll context 보존.
- 적용: 6 — sheet.open 상태로 inert guard, React 19 boolean prop 렌더링 확인.
- 적용: 7 — typecheck + tests 실행으로 검증.
