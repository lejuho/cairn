# Step 001 — Approach check: Cycle 76 Travel Time / Transition Cost A

Cycle: 76
Pass: 1
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
Backward from spec — checks:

1. Schema: `.optional()` travel on strict TransitionCostSchema is back-compat; existing fixtures stay valid. OK.
2. Gap: define `no_route` mapping. If cache `no_route` → travel.status must NOT be `fresh` (durationMinutes null). Guard "fresh && durationMinutes != null" or no_route silently adds 0 / NaN. Pick explicit status for no_route → reason code only.
3. Byte-identical: `params.travelMargin` MUST have a default; absent travelFacts path untouched — verify param parsing doesn't change existing schema.
4. Preview: assert allowProvider=false → zero upsert writes (test it).
5. fail-open: same_location epsilon must not call provider — confirmed.

Verdict: NEEDS_REVIEW

## Sonnet Response
- 적용 (2 — no_route mapping): Plan step 1/4 의 status enum 에 명시적으로 처리 추가. travel_time_cache.status=`no_route` 인 fact 는 TransitionTravel.status 를 `fresh`/`stale` 로 매핑하지 않고 별도 의미(durationMinutes=null, reason code only)로 surface 한다. Step 5 의 거리/시간 가산 guard 를 `status==="fresh" && durationMinutes != null` 로 강화해 no_route(또는 null duration)가 requiredMinutes 에 0/NaN 을 더하지 못하게 한다. (현재 plan 은 `fresh` + durationMinutes 동시 조건이지만 no_route→fresh 매핑 가능성을 차단하도록 명문화.)
- 적용 (3 — travelMargin default): params 스키마에 `travelMargin` 추가 시 `.default(...)` 로 기본값 보장. travelFacts 가 omit 되면 가산 경로 자체에 진입하지 않으므로 기존 fixture/param 파싱 byte-identical 유지. param schema 변경이 기존 DayFeasibility 응답에 영향 없음을 테스트로 확인.
- 적용 (4 — preview write-free): preview route(allowProvider=false) 가 upsertTravel 를 단 한 번도 호출하지 않음을 integration test 로 assert (spy/0-write).
- 적용 (1, 5): schema back-compat 와 same_location epsilon→no provider call 은 plan 과 일치(확인됨). 추가 조치 불필요.
- 무시: 없음. 모든 항목 plan/user intent(ADDITIVE + fail-open)와 정합하여 전부 반영.
