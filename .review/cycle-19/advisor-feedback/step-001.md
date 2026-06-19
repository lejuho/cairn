# Step 001 — cycle-19 NOW gating approach check

Cycle: 19
Pass: 1
Files Changed: (pre-implementation)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. `now` in resolve body — required. Add `now?: ISO datetime` to `ResolveConflictRequestSchema`, default to server time. Justified: route's actionability re-check is time-dependent; `test:integration` needs test-clock control. Validate with same `z.string().datetime({ offset: true })`.

2. Actionability rule: `resolvable` only if `start >= now AND start <= now + 6h` for at least one side. Past-start (start < now) → `read_only` even if not yet ended. `urgency` and `actionability` can legitimately diverge; keep `urgency` untouched. `disabledReasonCodes`: `["past_start"]` or `["far_future"]`.

3. Extract `isResolvable(now, aStart, bStart, horizon)` pure function in `services/decision.ts`, call it from both `buildConflictDecisions` and the resolve route. No drift possible.

4. Transaction ordering inside `db.transaction`: (a) exist→404, (b) active status→stale, (c) overlap→stale, (d) actionability→not-actionable, all before update/insert. Return distinct discriminant `{ status: 409, code: "CONFLICT_NOT_ACTIONABLE" }` — split from `CONFLICT_STALE`.

## Sonnet Response
- 적용: 모든 항목 적용. `now` body field 추가, strict forward-only gate, isResolvable 공통 함수 추출, 트랜잭션 순서 유지.
