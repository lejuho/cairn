# Step 001 — Approach check: Thread Settlement A (cycle-53)

Cycle: 53
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. New dedicated read: correct. EventRow type-erases cancel fields; reusing it forces casts. `findEventsWithCostsByThreadId` (full Drizzle row) keeps the service pure, EventRow unchanged.
2. Denominator matches computeProgress (events≠cancelled + tasks≠dropped; doneCount=done). paidCost from moved+cancelled is a separate axis — sound. Verify cancelled-as-paid-cost is intended though excluded from denominator.
3. ready iff thread.status==='done'; partial→sampleStatus='partial', no auto-correction.
4. Bucketing / null→0 / trimmed-window / eventCount regardless of money: correct.
5. avoidedMissing.money null + 'unavailable', knownAvoidedCount=doneCount: conservative, no overreach.
Before coding: confirm computeProgress predicates (don't assume); confirm `moved` is a real event status.

## Sonnet Response
- 적용: 1 — findEventsWithCostsByThreadId 신규 read (full row), service는 순수 유지
- 적용: 2 — countable = status != null && status ∉ {cancelled, dropped} (computeProgressFromRows의 EXCLUDED_STATUSES 확인); paidCost는 status∈{moved,cancelled} 별도 축. cancelled가 denominator 제외이나 paid-cost로 계상은 plan 명시(취소 자체가 비용).
- 적용: 3 — status='ready'는 thread.status==='done'일 때만, partial은 sampleStatus로만 표기
- 적용: 4 — effort 버킷(none|low|medium|high else unknown), money/social null→0, windowCount trimmed-non-empty, eventCount는 money와 무관
- 적용: 5 — avoidedMissing.money null/unavailable, knownAvoidedCount=doneCount
- 확인: computeProgressFromRows predicate(status!=null && ∉{cancelled,dropped}, done='done')와 EVENT_STATUSES에 'moved' 실재 — 둘 다 코드로 검증 완료
