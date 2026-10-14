# Step 001 — Approach check: Pinned Transit Facts A (shared, table, repo/service, precedence, frontend)

Cycle: 78
Pass: 1
Files Changed: (approach) — planned: shared/src/transitFacts.ts(+test), shared/src/feasibility.ts(+test), server/src/db/schema.ts(+test), drizzle/0012, server/src/repositories/pinned-transit-facts.ts(+integration test), server/src/services/pinned-transit-facts.ts(+integration test), server/src/services/travel-time.ts(+test), server/src/services/feasibility.ts, server/src/routes/transit-facts.ts(+integration test), server/src/routes/{feasibility,today}.ts, server/src/app.ts, web/src/Today.tsx(+test), web/src/styles.css, docs/*

## Advisor Verdict
PASS

## Advisor Feedback
1. Source-as-optional-field: correct over a new status. A new status would force every gap/sequence consumer to branch; provenance is orthogonal to freshness. Keep status:"fresh".
2. Directional unique key + server-stored coords: sound. Reject any browser coordinate; derive from geocode_cache only.
3. Precedence risk: ensure pinned short-circuits BEFORE cache/provider AND the gap adds duration*margin exactly once — assert no fallthrough to resolvePair.
4. Fail-open: pinned map build must try/catch → empty map, never break day math. Preview stays write-free.
5. Frontend: label pinned distinctly; never reuse provider copy. Confirm lastConfirmedAt updates on re-pin.
PASS

## Sonnet Response
- 적용 전부: (1) TransitionTravel에 optional source enum(provider|pinned_user), status는 "fresh" 유지 — gap/sequence 소비자 분기 불필요. (2) unique(origin_normalized,dest_normalized,mode) 방향성 + 좌표는 geocode_cache에서 서버 파생(브라우저 좌표 입력 거부, request schema strict). (3) buildDayTravelFacts 루프에서 pinned는 missing/same_location 다음, resolvePair 이전에 short-circuit return → cache/provider 미호출, gap은 fresh 경로로 duration*margin 정확히 1회 가산; pinned면 reason=gap_travel_pinned_included. (4) route에서 pinned facts 로드는 try/catch→빈 Map(fail-open, day math 안 깨짐); preview는 pinned read만, write 없음. (5) 프론트는 "고정 이동 약 N분"로 provider estimate와 구분 표기·provenance label; upsert(re-pin) 시 last_confirmed_at 갱신.
- 무시: 없음.
