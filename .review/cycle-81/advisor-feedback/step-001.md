# Step 001 — Approach check: Operational Soft Remove Controls A (task drop, reuse status route)

Cycle: 81
Pass: 1
Files Changed: (approach) — planned: web/src/Today.tsx(+test), web/src/Thread.tsx(+test), web/src/styles.css, server/src/routes/today.integration.test.ts, docs/*

## Advisor Verdict
NEEDS_REVIEW (1/3/5 PASS; 2 drop-vs-dismiss collision; 4 static asserts brittle)

## Advisor Feedback
1. PASS. Scoped `taskDropError` map mirrors `taskDismissError` — clean. Send exactly `{status:"dropped"}`, no extra fields. Don't reuse handleDone swallow.
2. NEEDS_REVIEW. Drop(permanent) vs 숨기기(one-day) collision is the real risk. Distinct labels/icons; add confirm for 드롭; never imply data deletion.
3. PASS. onSaved/refresh keeps task in doneTasks "드롭" group — historical evidence intact.
4. NEEDS_REVIEW. Today integration test (absent from twoMinuteTasks + dueTaskSchedulePrompts) is solid. Leave Watchers unchanged — good. But static "no-DELETE" asserts are brittle; prefer grep-in-test or skip.
5. PASS. Reuse-only, no block-event side effects, "드롭" copy, reversible. No creep.

## Sonnet Response
- 적용 (1,3,5): 그대로 — scoped taskDropError map, PATCH {status:"dropped"}만 전송(handleDone silent-swallow 미사용), Thread는 onSaved/refresh로 dropped 그룹 이동(historical evidence chip "드롭" 유지), reuse-only/no-cascade/no-block-side-effect.
- 적용 (2, distinct labels): 두 액션 라벨/aria 명확 구분 — 영구 soft-remove는 "드롭"(aria "…드롭 (활성에서 제거)"), 하루 숨김은 기존 "오늘 숨기기" 유지. "삭제" 단어 미사용(데이터 보존 함의). 시각적으로 drop은 secondary/quiet 버튼.
- 부분 적용/무시 (2, confirm modal): modal/window.confirm 미도입. 이유: 드롭은 reversible status(dropped로 history에 남고 hard delete 아님)이며, plan이 two-minute 카드에 "explicit low-friction 드롭"을 명시 → 무거운 confirm은 plan 의도와 충돌. 충돌 위험은 distinct label/aria + secondary 버튼 스타일로 완화. (collision은 schedule_prompt 카드에서만 두 액션 공존하므로 라벨 구분으로 충분.)
- 적용 (4): in-code no-DELETE 정적 assert는 추가하지 않음(brittle) — plan Sprint Contract의 static negative greps를 verify 단계에서 실행해 hard-delete 부재를 증명. Watchers.tsx는 코드 변경 없이 disarm 유지(회귀 방지). Today integration test로 dropped task가 active 표면에서 빠짐을 증명.
- 무시: 없음(2의 confirm만 사유 명시 후 부분 미적용).
