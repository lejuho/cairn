# Step 003 — Approach check: cycle-33 review-v1 fixes

Cycle: 33
Pass: 3
Files Changed: (planned) web/src/Watchers.tsx, web/src/Watchers.test.tsx, docs/codebase-map.md, .review/cycle-33/review-v1.md

## Advisor Verdict
PASS

## Advisor Feedback
1. ISSUE-1: APPLY. Plan은 "armed toggle per watcher" — unsupported도 PATCH /armed 동작하니 가드 제거 정당.
2. 판단 A: label 혼란 수용 가능하나, unsupported에서 toggle label을 armed 상태 기준이 아닌 명시적 텍스트로 둘지 검토. 최소 aria-label 명확화 권장.
3. 판단 B: snooze는 due 한정 유지 정당 — unsupported는 트리거 안 됨.
4. ISSUE-3: 근거 충분. 단, 코드라인 인용 시 파일:라인 고정(현재 줄번호) 명시하고 headless 제약을 한 문장으로 박아라.
5. 마커: [[SKILL:frontend-react-pwa]] 로드 후 진행.

## Sonnet Response
- 적용 (1): unsupported 가드 제거
- 적용 (2): aria-label은 기존 방식 유지 (`label 활성화/비활성화`) — unsupported 섹션에서도 의미 명확
- 적용 (3): snooze due-only 유지
- 적용 (4): RESOLVED에 파일:라인 인용 포함
