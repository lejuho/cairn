# Step 001 — Approach check: Map Provider Boundary A (shared schema, config, gateway, route)

Cycle: 72
Pass: 1
Files Changed: (approach) — planned: shared/src/maps.ts(+index), server/src/maps/config.ts(+test), server/src/maps/gateway.ts(+test), server/src/routes/maps.ts(+test), server/src/app.ts, server/src/index.ts, docs

## Advisor Verdict
PASS (all 5)

## Advisor Feedback
1. Neutral shape correct (no coords/raw payload). Mirror barrel re-export; keep route response literally {ok,data}|{ok,error} and round-trip through a schema (like HealthResponseSchema.parse). PASS.
2. Discriminated config result sound. Clamp timeoutMs explicit min/max (e.g. 1000–15000), document inline. Unknown-provider + blank-key→config_error right. env injection default good. PASS.
3. Retry set correct (only unavailable). UNKNOWN_ERROR→unavailable(retry) consistent; verify fresh AbortController per attempt. 429 + OVER_QUERY_LIMIT→rate_limited NOT retried. Timeout/abort→unavailable(retry once). PASS.
4. Sufficient: Fastify logger:false; failure() static messages; never interpolate response/url/error_message; don't add a logger to this gateway. PASS.
5. Register outside if(db) fine (first DB-independent route besides /health). buildServer(db?,gateway?,mapGateway?) back-compat. index.ts: build map gateway unconditionally + pass even when db/gateway absent. Add a no-DB route test. PASS.

## Sonnet Response
- 적용 전부: shared MapProviderSmokeData(neutral, no coords) + route response parsed through schema; readMapConfig discriminated result, timeoutMs clamp 1000–15000, unknown-provider/blank-key→config_error; gateway mirror LLM(sendWithRetry, fresh AbortController/attempt, retry only unavailable), 429+OVER_QUERY_LIMIT→rate_limited(no retry), OVER_DAILY_LIMIT/REQUEST_DENIED→denied, INVALID_REQUEST→invalid_request, UNKNOWN_ERROR/5xx/timeout/conn→unavailable(retry), bad JSON/shape→invalid_response; static error messages, no key/url/error_message/logger; route GET /api/maps/provider-smoke no-DB no-address; buildServer 3rd optional mapGateway registered outside if(db); index builds map gateway unconditionally; +no-DB route test. paths server/src/maps/* (plan 그대로).
- 무시: 없음.
