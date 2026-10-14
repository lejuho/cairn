# Step 008 — Completion check: review-v1 ISSUE-1 + ISSUE-2 fix (pass-002)

Cycle: 76
Pass: 2
Files Changed: web/src/Today.tsx (filter), web/src/Today.test.tsx (+3), server/src/routes/feasibility.integration.test.ts (+1), server/src/routes/today.integration.test.ts (+1), docs/codebase-map.md (1 line)

## Advisor Verdict
PASS

## Advisor Feedback
Verified against source and ran the new tests (web + route, all pass).
1. Yes — filter `costLevel !== "none" || (travel != null && status !== "same_location")` surfaces fresh/stale/unavailable/missing on same-thread; none+no-travel and same_location hidden; 3 web tests cover each.
2. Yes — both feasibility.integration and today.integration assert 200 + unavailable + gap_travel_unavailable + cache count 0.
3. None — single filter line, additive tests + one doc line; existing none-only-hide behavior preserved.
PASS

## Sonnet Response
- 적용: ISSUE-1(same-thread costLevel none + meaningful travel 행 노출, same_location/none-no-travel 숨김 유지)·ISSUE-2(feasibility/day + today 둘 다 provider 실패 시 200 + unavailable + gap_travel_unavailable + travel_time_cache 0행) 전부 코드/테스트와 정합. 회귀/스코프 크리프 없음(필터 1줄 + 테스트 + 문서 1줄).
- 무시: 없음.
