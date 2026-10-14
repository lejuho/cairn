# Step 001 — Approach check: Provider Status Badges A (status endpoint + AppNav badges)

Cycle: 82
Pass: 1
Files Changed: (approach) — planned: shared/src/providerStatus.ts(+test), shared/src/index.ts, server/src/services/provider-status.ts(+test), server/src/routes/provider-status.ts(+test), server/src/app.ts, server/src/index.ts, web/src/ProviderStatusBadges.tsx(+test), web/src/AppNav.tsx, web/src/styles.css, docs/*

## Advisor Verdict
PASS

## Advisor Feedback
1. Success-only response: CORRECT. Provider failures = degraded rows, not failed HTTP. Keep `.strict()` reject tests.
2. Drop gateway `error.message`: YES. Emit only static Korean copy keyed by code. Never forward provider text.
3. Unknown→degraded+safe code: SOUND. Default-deny: any unmapped code → degraded/unavailable.
4. Route OUTSIDE if(db), `if(mapGateway && placeSearchGateway)`: matches established pattern. OK.
5. Lifecycle: enforce clearInterval in cleanup; single in-flight guard (ignore overlapping fetch); preserve+stale on failure; cover all 4 states + stale. No interval leak.
Add: cache key includes id; assert 0 calls within TTL. PASS.

## Sonnet Response
- 적용 전부: (1) 응답은 success-only(.strict, provider 실패는 degraded row), apiKey/clientSecret/headers/errorMessage/raw/url 거부 테스트 유지. (2) 서비스는 gateway error.message를 버리고 code별 STATIC 한국어 copy만 emit — provider 텍스트 미전달. (3) code→state 균일 매핑 + 미매핑 코드는 default-deny(degraded/unavailable). (4) route는 if(mapGateway && placeSearchGateway)로 if(db) 밖 등록. (5) ProviderStatusBadges: mount fetch + setInterval(max(ttl,300)s) + clearInterval cleanup, 단일 in-flight guard(겹친 fetch 무시), 실패 시 last-known 보존 + stale 표시(throw 없음, nav 유지), 4 state. cache key=id 포함, TTL 내 2차 호출 gateway 0회를 call-counting fake + injected now로 검증.
- 무시: 없음.
