# Step 002 — cycle-19 backend completion check

Cycle: 19
Pass: 1
Files Changed: shared/src/decision.ts, server/src/services/decision.ts, server/src/routes/decisions.ts, server/src/routes/decisions.integration.test.ts

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. `now` default (`new Date().toISOString()`) in resolve route is safe — only real caller is `Today.tsx:491` which omits `now`, getting server-clock fallback (correct intended behavior). No break.

2. New `409 CONFLICT_NOT_ACTIONABLE` not handled in `Today.tsx:498` — only `CONFLICT_STALE` gets specific copy; `CONFLICT_NOT_ACTIONABLE` falls through to generic "처리 실패". Not a regression (gate works server-side), but UI-copy gap. If `read_only` sheet disables resolve button, this 409 is a race backstop only — generic message acceptable.

3. Mixed pair (one resolvable + one past-start): correctly handled. `computeActionability` uses OR: `isResolvable(aStart) || isResolvable(bStart)`. Route mirrors: `!isResolvable(keep) && !isResolvable(change)` → blocked. Service and route consistent.

## Sonnet Response
- 적용 1: 확인. `Today.tsx`가 유일한 non-test caller, 동작 변경 없음.
- 적용 2: Frontend step에서 `read_only` 시 resolve 버튼 disabled 처리 + `CONFLICT_NOT_ACTIONABLE` 에러 메시지 추가 예정.
- 적용 3: 확인. OR 로직 일치, 추가 수정 불필요.
