# Step 001 — approach: mirror patterns service (cycle 28)

Cycle: 28
Pass: 1
Files Changed: (pending — pre-implementation check)

## Advisor Verdict
PASS

## Advisor Feedback
1. MirrorRangeQuerySchema: extract two optional date fields only (no from<=to refine).
   Keep the from<=to .refine on MirrorLedgerQuerySchema and apply identical refine on
   MirrorPatternsQuerySchema. Do NOT alias them — aliasing couples ledger/pattern tests
   and lets one schema's constraint changes silently affect the other.
2. Repository: add separate `findAllOutcomeAnnotations` (all 4 outcomes: done/moved/
   cancelled/late). Leave `findMovedCancelledAnnotations` untouched. Renaming would
   force ledger to re-filter in-service, blurring the repo "ledger=moved/cancelled"
   contract and risking ledger regression. Two narrow read-only queries.
3. Weekday from events.start: extract calendar date via `start.slice(0,10)`, then
   `Date.parse(\`${date}T00:00:00Z\`).getUTCDay()`. Avoids host-tz dependence of
   `new Date(start).getDay()`. Null/malformed/NaN → `unknown` bucket. Document accepted
   UTC skew same as cycle 27 loggedAt approach.

## Sonnet Response
- 적용 1: MirrorRangeQuerySchema = date fields only; ledger/patterns 각자 from<=to refine 유지.
- 적용 2: findAllOutcomeAnnotations 별도 추가; findMovedCancelledAnnotations 유지.
- 적용 3: start.slice(0,10) + getUTCDay() 방식 사용; accepted skew 인라인 주석.
- 무시: 없음.
