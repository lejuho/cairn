# Step 001 — Approach check: Today Location Context A (shared, builder, repo, route, frontend chips)

Cycle: 75
Pass: 1
Files Changed: (approach) — planned: shared/src/today.ts(+test), server/src/repositories/geocode-cache.ts, server/src/services/today-location-context.ts(+test), server/src/services/today.ts, server/src/routes/today.ts(+integration test), web/src/Today.tsx(+test), web/src/styles.css, docs/*

## Advisor Verdict
NEEDS_REVIEW (1/2/3/5 PASS; #4 uncached-link honesty)

## Advisor Feedback
1. Shape PASS. .strict, reuse maps.js schemas. Confirm `locationContexts` is additive on TodaySurfaceSchema and contract test snapshots updated.
2. Builder PASS. Dedup-by-id + provider-asc pick deterministic. uncertainty JSON.parse → GeocodeUncertaintySchema.safeParse → null fail-open good. Map cache resolved|ambiguous|zero_results|failed directly; missing/uncached builder-only.
3. Repo PASS. New findGeocodeByNormalizedSet justified (findGeocodeByKey is provider-scoped single). inArray + empty guard, read-only. Append as last buildTodaySurface param.
4. NEEDS_REVIEW: uncached map link — flag honesty (unverified text); confirm vs point-5 intent. Chip as sibling <li> child (not in button) correct.
5. PASS. No reprioritize, no provider call, no key/providerResultId leak.

## Sonnet Response
- 적용 (#4): uncached는 map link 제거 — authored text + quiet "확인 안 함" 칩만. 이유: uncached = "아직 확인 안 함"이라 지도 링크가 인식했다는 인상을 줄 수 있음(advisor honesty 지적). plan의 uncached 스펙도 map action을 명시하지 않음. resolved/ambiguous/zero_results/failed는 cache-backed(실제 geocode 결과를 본 상태)이므로 map link 유지(cycle-74 선례 — zero/failed도 authored-text 링크 허용).
- 적용 전부 (1/2/3/5): 그대로. locationContexts는 TodaySurfaceSchema에 additive; today.test 스냅샷/케이스 갱신; builder dedup-by-id + provider asc pick + uncertainty fail-open; findGeocodeByNormalizedSet read-only(inArray+empty guard); route는 cache-only(provider/geocode 호출 없음), card order/priority 불변; chip은 title button의 sibling(중첩 없음); URL은 encoded coords/authored text만(키/raw 없음), providerStatus/providerResultId UI 미노출.
- 무시: 없음.
