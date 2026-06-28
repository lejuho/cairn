# Step 001 — Approach check: Geocoding Cache A (shared, table, gateway geocode, repo/service/route)

Cycle: 73
Pass: 1
Files Changed: (approach) — planned: shared/src/maps.ts(+test), server/src/db/schema.ts, drizzle/0010, server/src/maps/{gateway,normalize}.ts(+test), server/src/repositories/geocode-cache.ts, server/src/services/geocoding.ts, server/src/routes/geocoding.ts(+integration test), app.ts, db/schema.integration.test.ts, docs

## Advisor Verdict
PASS (all 5, with refinements)

## Advisor Feedback
1. Shape right. Nits: `cacheStatus` is a response-envelope concern — derive it, do NOT store in the cache row. Constrain `uncertainty` to a typed object (locationType?/partialMatch?/resultCount?/candidateLabels?), not open `object`. providerStatus nullable string fine.
2. geocodeAddress sound; resolved=exactly-1 + confidence/partial_match demotion correct. Consistency flag: cycle-72 smoke maps INVALID_REQUEST→scoped `invalid_request`; geocode reinterprets it as cacheable `failed` (stable address vs fixed smoke). Defensible — DOCUMENT the intentional divergence. Static messages.
3. Table OK. uniqueIndex(provider, normalized_location) correct key; `(latitude is null)=(longitude is null)` valid. confidence NOT NULL needs a guaranteed writer value (`unknown`). Verify db:generate emits only CREATE TABLE/index (no rebuild); add to schema.integration.test list.
4. normalize + repo deterministic/idempotent. NFKC→trim→collapse→lowercase stable. onConflict DO UPDATE refreshing updated_at/last_checked_at correct. Confirm the SAME normalized value feeds findByKey + upsert (single normalize upstream). No provider calls in repo.
5. No scope creep / secret leak (errors carry {code} only, static messages). Gaps: (a) null→404, blank→409 BEFORE gateway/cache; (b) config_error and disabled both 503 but distinct body codes; (c) one row on miss via single upsert; cache hit does NOT refresh timestamps; (d) register route only when db+mapGateway.

## Sonnet Response
- 적용 전부: shared cacheStatus는 응답에서 파생(row 미저장), uncertainty 타입드 객체(.strict locationType?/partialMatch?/resultCount?/candidateLabels?); INVALID_REQUEST geocode→failed(cacheable) 분기 주석으로 smoke와의 의도적 차이 명시; confidence는 항상 값 공급(unknown 기본); service에서 normalize 1회 후 findByKey+upsert 동일값; cache hit 시 timestamp 갱신 안 함(저장 row 그대로 반환, freshness는 후속 사이클); 체크 순서 null→404→blank→409→gateway/cache; disabled/config_error 둘 다 503 but 별도 code; miss는 단일 upsert로 정확히 1행; route는 db+mapGateway일 때만 등록; db:generate 후 rebuild 없는 additive만 유지.
- 무시: 없음.
