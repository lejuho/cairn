# Step 003 — review-v1 epoch fix approach

Cycle: 21
Pass: 2
Files Changed: server/src/repositories/people.ts, server/src/routes/people.integration.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
**1. Epoch parsing for filter + lastMet — SOUND, with one correctness note.**
- `events.end` is `text` (schema.ts:56), written from `mapEnd` which passes Google's raw `dateTime` through unnormalized — fixtures store `+09:00` offsets. Lexical `r.end < nowIso` is wrong across offsets. `Date.parse(r.end) < Date.parse(nowIso)` is correct.
- Storing `lastMet` as raw RFC3339 string (not epoch) is right — keep wire format, compare by epoch only.
- Watch: `Date.parse` returns `NaN` on malformed input. Add `Number.isFinite(Date.parse(r.end))` so bad rows are excluded explicitly. For `lastMet` reduce, compare `Date.parse(r.end) > Date.parse(best)`.

**2. Boundary tests at 2 and 7 — extra data points, not new it() cases.**
- Add 2 and 7 as additional rows/assertions inside existing band tests (standalone it() only if off-by-one is the real risk at that exact boundary).

**3. Mixed-offset test — VALID and necessary; proves the fix.**
- Insert one event `...+09:00` and one `...Z`, both past relative to a `Z` `nowIso`. Assert `totalMeets === 2` and `lastMet` picks chronologically-latest by epoch (not lexically-largest string). Add a future row that is lexically `<` nowIso to lock filter direction.

## Sonnet Response
- 적용: Number.isFinite guard on Date.parse; epoch reduce for lastMet; boundary 2 and 7 in existing tests; mixed-offset it() test
- 무시: 없음
