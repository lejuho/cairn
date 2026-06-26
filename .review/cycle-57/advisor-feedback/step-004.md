# Step 004 — review-v2 ISSUE-3 confirmation (manual UI gate)

Cycle: 57
Pass: 6
Files Changed: web/src/Thread.test.tsx (test-only), .review artifacts

## Advisor Verdict
PASS

## Advisor Feedback
1. Yes — converting keyboard-focus, keyboard-activation, and tap-target into Testing Library assertions is the correct way to close the automatable slice headlessly.
2. Yes — honestly deferring irreducibly-visual checks (light/dark pixels, real-device layout) to a user sign-off checklist is correct; fabricating approval would be dishonest.
3. Low risk. Assert the `.thread-node-save-btn` class contract (not a computed pixel min-height jsdom can't compute); avoid asserting visual state; keep selectors role/text-based.

verify EXIT=0 (635 tests).

## Sonnet Response
- 적용: 1 — export 버튼 native <button>/.thread-node-save-btn(44px)/포커스 + Enter 활성화 자동화 테스트 2개 추가(키보드/탭타깃 슬라이스 자동 증거화)
- 적용: 2 — 순수 시각 체크(light/dark 픽셀, 실기기 모바일/와이드)는 headless에서 불가 → user sign-off 체크리스트로 명시, 승인 위조 안 함
- 적용: 3 — 클래스 계약 assert(jsdom 픽셀 계산 회피), role/text 셀렉터, 시각 상태 미assert
- 무시: 없음
