# Step 001 — Approach check: Person Thread Focus A (schema, read-only helper, nodeClass, CSS)

Cycle: 66
Pass: 1
Files Changed: (approach only) — planned: shared/src/threads.ts(+test), server/src/repositories/people.ts, server/src/services/threads.ts, server/src/routes/threads.integration.test.ts, web/src/Thread.tsx(+test), web/src/styles.css, docs/codebase-map.md

## Advisor Verdict
PASS (one minor on CSS)

## Advisor Feedback
1. PASS. ThreadDetailSchema is non-strict; rollup/settlement are required there — required `personFocus` matches the pattern. New minimal `{id,name,relation}` strict schema (not reusing PersonRowSchema) is correctly lean.
2. PASS. `threadEvents = findEventsByThreadId(db,id)` scopes eventIds to this thread → read-only/correct. New helper avoids the stats in `findEventPeopleContext` — good.
3. PASS. Exactly 5 nodeClass call sites (header, activeTasks, future, past, doneTasks). Mutual clearing is sound; confirm dimming tasks/header in person mode is intended UX.
4. NEEDS_REVIEW (minor): duplicating CSS is safe but consider reusing the same highlight/dim class names to avoid drift.
5. Confirmed: single-mode invariant holds.
Verdict: PASS.

## Sonnet Response
- 적용 (1,2,3,5): required personFocus(rollup/settlement 패턴)/lean strict schema/lean read-only helper(threadEvents로 eventIds 스코프)/nodeClass(base, resourceHL, personHL) 5콜사이트 갱신 + 상호배타 클리어/single-mode 불변식 그대로 진행.
- 적용 (3 header UX 확인): person mode에서 thread-header와 task 노드는 personHL=false → dimmed. plan이 "dims unrelated event/task nodes"를 명시하고, 기존 resource focus도 thread-header를 dim하므로 일관성 유지(focus된 사람의 이벤트만 강조, 나머지 dim). 의도된 UX로 확정.
- 적용 (4 minor — drift 회피): 별도 클래스 중복 정의 대신 **grouped selector**로 기존 resource 규칙에 person 클래스명을 추가(`.resource-highlight, .person-highlight {…}` / `.resource-dimmed, .person-dimmed {…}` / `.resource-chip, .person-chip {…}` / `--active` 동일). 동일 값 단일 정의 → drift 0, 기존 resource 클래스명/테스트 불변, person 전용 클래스명으로 시맨틱·테스트 명료성 확보.
- 무시: 없음.
