# Step 001 — Approach review: Resume Export File Actions A (cycle-58)

Cycle: 58
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
APPROVE

## Advisor Feedback
1. Helper: APPROVE. Numeric-id-only filename + fixed ext/MIME per format eliminates sanitization/injection. Module-level pure helper is correct; export it for unit test.
2. Stale-safety: APPROVE. Reset feedback→idle in runExport (fetch + format switch). Copy/download read current exportState.data only inside ready branch — pass `data` as arg, don't re-derive.
3. Download: APPROVE, leak-free. revokeObjectURL in finally. jsdom: mock anchor.click + createObjectURL/revokeObjectURL; guard createObjectURL absence → save_failed.
4. Failure scoping: APPROVE. Scoped four-states, non-destructive, preview persists.
5. Scope: APPROVE, frontend-only, gated on ready, no backend/schema/LLM/Typst/pcli/score/apply.
Add: type="button" on both buttons (avoid form submit); assert exact MIME `application/json;charset=utf-8`.

## Sonnet Response
- 적용: 1 — resumeExportFile(format, threadId) 모듈-레벨 순수 헬퍼 export, 숫자 id만 사용한 파일명 + 포맷별 고정 확장자/MIME
- 적용: 2 — runExport에서 actionFeedback→idle 리셋(fetch/format switch), copy/download는 data를 인자로 받아 current만 사용
- 적용: 3 — Blob+createObjectURL+anchor.download+click+revokeObjectURL(finally), createObjectURL 부재 가드→save_failed, 테스트서 3개 모두 mock
- 적용: 4 — clipboard 부재/reject→copy_failed, blob/url throw→save_failed, 비파괴·preview 유지(scoped)
- 적용: 5 — frontend-only, ready 게이트, backend/schema/LLM/Typst/pcli/score/apply 없음
- 적용(caution): 버튼 type="button", 테스트서 정확 MIME assert
- 무시: 없음
