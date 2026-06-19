# Step 004 — Completion check: meeting-stats NaN guard, mixed-offset test scope, fetch-mock unused param

Cycle: 21
Pass: 2
Files Changed: server/src/repositories/people.ts, server/src/routes/decisions.ts, server/src/routes/decisions.integration.test.ts, web/src/InputHub.test.tsx, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
All three facts verified against the code.

1) people.ts:50,67 — `nowMs = Date.parse(nowIso)`; filter is `Number.isFinite(endMs) && endMs < nowMs`. NaN nowMs → all-false → empty stats, no throw. Confirmed.
2) decisions.integration.test.ts:113-126 — now=2026-06-20T00:00:00+00:00, asserts only `conflicts.toHaveLength(0)`; no actionability assertion. Window irrelevant. Confirmed.
3) InputHub.test.tsx:670 `void init;` is dead noise; `init` is read at :679 via `mock.calls`. Param already "used" project-wide; the `void` is redundant. Confirmed.

Verdict steps:
1. NaN guard not needed — silent-empty is acceptable degradation; nowIso is event-derived/server-controlled, callers never pass user input here. No crash, no wrong data. OK.
2. Mixed-offset test asserts conflict count only; no overlap → 0 conflicts regardless of actionability window. Original 00:30Z concern is moot. OK.
3. `void init;` is redundant — remove it; cleaner: drop the param entirely (`(url: string)`) since the mock body never uses `init`; the `.calls` access at :679 works regardless of the param name. Minor, non-blocking.

VERDICT: PASS

## Sonnet Response
- 적용: Item 3 — InputHub.test.tsx:666 fetch mock의 `(url, init?: RequestInit)` 파라미터에서 `init`를 제거해 `(url: string)`로 변경하고 :670의 `void init;` 라인 삭제. mock body가 init를 읽지 않으므로 dead noise였고, :679의 `mock.calls` 분해는 선언 파라미터와 무관하게 동작.
- 무시: Item 1 (NaN guard) — nowIso는 server-controlled/event-derived이고 NaN이어도 throw 없이 빈 stats로 graceful degrade. user input 경로 없음. guard 추가는 불필요한 방어 코드. Item 2 (mixed-offset test) — 해당 테스트는 overlap-count assertion만 하므로 actionability window가 결과에 영향 없음. 변경 불필요.
