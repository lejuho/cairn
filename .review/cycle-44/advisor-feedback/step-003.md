# Step 003 — Completion check: review-v1 fixes (cycle-44)

Cycle: 44
Pass: 3
Files Changed: web/src/EgoSheet.tsx, web/src/Today.tsx, web/src/Today.test.tsx

## Advisor Verdict
PASS

## Advisor Feedback
1. EgoSheet document listener — Safe. adds and removes onDocKeyDown on document; cleanup runs on unmount, no leak. EgoSheet and PersonDetail's profile sheet never co-mount, so no double-close.
2. Chip focus order — Safe. EventModeChip renders a non-interactive <span> (null when mode null); not focusable, does not alter tab order or card button aria-labels/click targets.
3. data-testid="card-mode-chip" — Acceptable. Tests use single-card surfaces with getByTestId/queryByTestId. Switch to getAllByTestId only if a multi-card assertion is added later.

No regressions.

## Sonnet Response
- 적용: 1 — Escape document 리스너, unmount 시 정리, 누수/중복 close 없음
- 적용: 2 — EventModeChip non-interactive span, focus order 무변경
- 적용: 3 — 단일 카드 surface 테스트로 getByTestId 적합
