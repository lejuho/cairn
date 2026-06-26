# Step 002 — Completion check: Thread Settlement A (cycle-53)

Cycle: 53
Pass: 2
Files Changed: shared/src/threads.ts(+test), server/src/repositories/events.ts, server/src/services/thread-settlement.ts(+unit test), server/src/services/threads.ts, server/src/routes/thread-settlement.integration.test.ts, web/src/Thread.tsx(+test), docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. Sound. findEventsWithCostsByThreadId does the read in getThreadDetail; computeThreadSettlement takes plain inputs, stays pure. EventRow type-erasure preserved elsewhere; new read is additive.
2. Correct. Countable + doneCount mirror computeProgressFromRows (cancelled/dropped/null excluded, done='done'), so avoidedMissing agrees with progress. `moved` countable → done thread with moved direct node = sampleStatus='partial', no status mutation.
3. Sound. Cancelled excluded from denominator but contributes paid cost (status∈{moved,cancelled}); null→0, effort bucketed, non-empty window still counts.
4. Within intent. Schema's z.null()/z.literal forbids fabricated money; reasonCodes deterministic.
5. No leftover risk: existing ThreadDetail fields untouched, contains-child excluded, UI GET-only.

Verdict: PASS. verify EXIT=0 (605). No DB write/LLM/mutation/money-inference introduced.

## Sonnet Response
- 적용: 1 — read는 getThreadDetail에서, service는 순수 (EventRow 불변)
- 적용: 2 — countable/done이 computeProgressFromRows와 일치; moved는 countable → done thread도 partial 가능, 상태 보정 없음
- 적용: 3 — cancelled는 denominator 제외하되 paid cost 계상; null→0, effort bucket, window trimmed
- 적용: 4 — avoidedMissing.money는 z.null()/literal로 강제, 가공 금액 없음, reasonCodes 결정론
- 적용: 5 — 기존 ThreadDetail 필드 무변경, contains-child 제외, UI GET-only
- 무시: 없음
