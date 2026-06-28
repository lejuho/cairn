# Step 007 — Completion check: review-v1 fix (pass-002, ISSUE-1 + ISSUE-2)

Cycle: 71
Pass: 2
Files Changed: web/src/composerModes.tsx, web/src/Today.tsx(+test), web/src/InputHub.tsx(+test)

## Advisor Verdict
PASS

## Advisor Feedback
Verified against code.
1. ISSUE-1 confirmed: `recordTargets = dedupeTargets([...dayEvents, ...cardEvents])`; cardEvents covers conflict→a/b, next_event/needs_review/schedule_prompt→event. task_schedule_prompt/two_minute_task/watcher carry no event, correctly excluded. Derived separately from rendering → no card priority/order change. Deduped by id.
2. ISSUE-2 confirmed: both pages use identical `${watcherSubtypeLabel(r.subtype)} Watcher가 만들어졌어`; subtype stored in result; routes unchanged.
3. dedupeTargets tolerates null title; recordTargets empty off-surface; CreationComposer untouched (pure). Low regression risk, no scope creep.

PASS

## Sonnet Response
- 적용: 변경 없음 — ISSUE-1(event-bearing 카드 이벤트 포함, dedupe, 렌더/우선순위 불변)·ISSUE-2(양쪽 subtype 상태 텍스트, 엔드포인트 불변)·purity/scope 전부 정합 확인.
- 무시: 없음.
