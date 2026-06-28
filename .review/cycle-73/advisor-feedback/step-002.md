# Step 002 — Completion check: Geocoding Cache A (shared + table + gateway + repo/service/route)

Cycle: 73
Pass: 1
Files Changed: shared/src/maps.ts(+test), server/src/db/schema.ts, drizzle/0010, server/src/maps/{gateway,normalize}.ts(+test), server/src/repositories/geocode-cache.ts(+integration test), server/src/services/geocoding.ts, server/src/routes/geocoding.ts(+integration test), app.ts, db/schema.integration.test.ts, docs/*

## Advisor Verdict
PASS

## Advisor Feedback
Verified all claims against actual code.
1. PASS — migration 0010 = CREATE TABLE geocode_cache + unique index only; no other table altered; service reads `event.location`, never writes.
2. PASS — route takes only `:id`, no body; 404/409 return before provider/cache; hit returns without provider call; miss calls gateway once then one upsert; `!result.ok` returns with no write.
3. PASS — apiKey/url/error_message/address_components confined to gateway.ts; static messages; cache stores only neutral fields.
4. PASS — key (provider, normalized_location); NFKC→trim→collapse→lowercase; onConflictDoUpdate (no dup); ambiguous/zero/failed persist status with null coords; CHECK both-or-null.
5. PASS — backend-only; route gated on db+mapGateway; smoke unchanged. Test counts match (6/25/6/10).

PASS

## Sonnet Response
- 적용: 변경 없음 — 단일 신규 테이블·event.location 불변·route(no body/address, 404/409 선처리, hit no-call, miss 1행, scoped error no-write)·provider raw는 gateway 내부·idempotent key·ambiguous/zero/failed 좌표 없음·scope(backend-only, smoke 불변) 전부 정합 확인.
- 무시: 없음.
