# Step 005 — evaluateWatcherA snooze comparison fix (approach)

Cycle: 27
Pass: 5
Files Changed: server/src/services/watchers.ts,
  server/src/services/watchers.test.ts,
  server/src/routes/watcher-evaluation.integration.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
- NaN → fail-open (surface): Correct. A corrupt `snoozedUntil` silently suppressing
  a watcher is the dangerous failure; surfacing is recoverable/visible. Keep it.
- Trust `now`, but guard cheaply: Route validates RFC3339, but `evaluateWatcherA`
  is a reusable service fn — a NaN `nowMs` makes every `snoozedMs > NaN` false
  (all surface). That's already fail-open, so no crash; still, document the precondition.
- Don't reparse per row: Compute `nowMs` once outside the loop.
- Tests: (a) unit mixed-offset same-instant (`+09:00` vs `Z`) → still snoozed;
  (b) unit invalid `snoozedUntil` → surfaces; (c) integration persisted `+09:00`,
  `Z` now-param boundary. Cover the equal-instant edge (`>` not `>=`).
- Comment the why: one line noting lexicographic compare is unsafe across offsets.

## Sonnet Response
- 적용: nowMs를 루프 밖에서 1회 parse. NaN → fail-open 유지. snooze 블록에 instant 비교 적용.
  lexicographic 비교가 offset 간 안전하지 않다는 주석 추가. unit 3개(mixed-offset expired/future,
  invalid) + integration 2개(mixed-offset expired/future) 추가. `>` 경계 유지(정확히 now == expired).
- 무시: 없음. (now NaN 방어 주석은 추가했으나 별도 throw/assert는 미추가 — fail-open이 이미
  안전하고 route 레벨 RFC3339 검증이 선행하므로 과잉 방어를 피함.)
