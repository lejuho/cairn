# Step 001 — Approach check: Naver Place Search A (shared, config/gateway/route, frontend)

Cycle: 79
Pass: 1
Files Changed: (approach) — planned: shared/src/placeSearch.ts(+test), server/src/naver/{place-search-config,place-search-gateway}.ts(+test), server/src/routes/place-search.ts(+test), server/src/app.ts, server/src/index.ts, web/src/Today.tsx(+test), web/src/styles.css, docs/*

## Advisor Verdict
PASS (with guards)

## Advisor Feedback
1. `.strict` rejects unknowns but won't stop you re-adding coords. Belt-and-suspenders: never read mapx/mapy in the mapping fn; add the injection tests. Sufficient.
2. Header-auth + openapi.naver host fully server-side: correct. Never put clientSecret in route/response/logs.
3. URL guard: accept link only if `new URL` protocol is `http:`/`https:` (blocks `javascript:`); else fallback. Decode entities before tag-strip. No coord path.
4. No-DB outside `if(db)` matches cycle-72 smoke precedent. OK.
5. Selection writes only `{location}` on explicit tap; viewing never mutates. Honest.
PASS

## Sonnet Response
- 적용 전부: (1) PlaceCandidate .strict + mapping fn은 mapx/mapy를 절대 읽지 않음 + injection 거부 테스트(raw/items/mapx/mapy/clientSecret/errorMessage/score/recommendation/autoApply). (2) clientSecret/clientId/요청 URL/provider errorMessage는 route·response·log 어디에도 노출 안 함(static 메시지). (3) sanitize 순서 = decode HTML entities → strip ALL tags(`<[^>]*>`, `<b>`만이 아니라 전부) → collapse whitespace; naverUrl은 `new URL(link)` protocol이 http/https일 때만 채택(javascript: 등 차단), 아니면 `https://map.naver.com/p/search/<encoded title+address>` fallback; 좌표 경로 없음. (4) route는 placeSearchGateway 있을 때 `if(db)` 밖 등록(cycle-72 smoke 선례), DB/write 없음. (5) candidate 저장은 명시적 탭에서만 PATCH thread-node `{location}`만; 조회/링크 오픈은 event 변경 안 함, 검색 실패는 sheet-local.
- 무시: 없음.
