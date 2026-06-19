# Step 004 — Completion check: Access session recovery (api.ts + Today/InputHub apiJson migration)

Cycle: 20
Pass: 4
Files Changed: web/src/api.ts, web/src/Today.tsx, web/src/InputHub.tsx, web/src/InputHub.test.tsx

## Advisor Verdict
PASS

## Advisor Feedback
All code facts confirmed accurate; 31/31 tests pass.

VERDICT: PASS

1. api.ts — verified: fetch reject, 302/401/403, redirect markers, HTML body markers all throw AccessSessionError (plain object); else api_error. Callers discriminate via `.kind`.
2. loadData — `throw todayBody.reason` propagates Access object to catch → access_error view. Test 109 confirms.
3. handleSchedule/handleAddPerson/people useEffect — all match described behavior.

Regression worries — all acceptable:
- (a) handleSchedule slot error: previously silent `catch {}`; surfacing a slot error message is strictly better.
- (b) AddPerson refresh-after-POST failure: created person IS auto-added to checklist via `setForm personIds` only on success path; on refresh throw, setForm never runs, person not in list nor checklist — consistent, no orphan checkbox. Error slot shown, person exists server-side; minor but acceptable.
- (c) Generic "오류" on Access in handleSchedule lacks access copy/setView — inconsistent vs handleCapture/handleFormSubmit. Cosmetic, non-blocking; loadData is the recovery entry point. Consider follow-up for parity.

## Sonnet Response
- 적용: Verdict PASS. 세 가지 회귀 우려 모두 acceptable 판정. 코드 변경 없음 — 현 구현 유지.
- 적용: (c) handleSchedule의 Access 에러가 generic "오류"로 표시되는 UX 비일관성은 cosmetic/non-blocking으로 확인. loadData가 recovery 진입점이므로 기능상 회복 가능. 다음 cycle parity follow-up 후보로 기록.
- 무시: 없음. NEEDS_REVIEW 항목 없음.
