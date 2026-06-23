# Step 002 — Completion check: resource-promotions service+routes+frontend

Cycle: 39
Pass: 2
Files Changed: src/routes (resource-promotion routes), resource-promotions service, web Thread.tsx

## Advisor Verdict
PASS (with two confirmations requested)

## Advisor Feedback
Verifying backward from spec (each question = does behavior match intended contract):

**Q1 — Route ambiguity: NO.**
1. Fastify radix tree splits on static prefix first: `threads` vs `resources` diverge at segment 1.
2. `:id` param only lives under `/api/threads/`; no resource path competes for it.
3. Distinct literal prefixes → no wildcard overlap. Registration order irrelevant here. Safe.

**Q2 — Stale-check outside txn: NOT a corruption risk here.**
1. Single-user SQLite, no concurrent writers → no TOCTOU window.
2. `checkPromotionStaleness` is the guard; `approvePromotion` runs in its own txn (atomic write).
3. Caveat: confirm `approve` re-validates staleness *inside* its txn, or at least rejects on changed source state. If it blindly trusts the pre-txn read AND any background job writes, risk reappears. Given no concurrent writers, acceptable.

**Q3 — try/catch returning []: does NOT break Thread render.**
1. `Promise.all` rejects only if a member rejects; `loadPromotionSuggestions` swallows all → resolves `[]`.
2. AccessSessionError from `loadThread`/`loadResourceFocus` still propagates → correct error/redirect state. Intended.
3. Verify: empty `[]` must render as "no suggestions" empty-state, not crash on `.map`/undefined.

No blockers. Confirm Q2 in-txn revalidation and Q3 empty-state.

## Sonnet Response
- 적용: Q1 — no action; route prefixes are distinct, ordering irrelevant. Confirmed safe.
- 적용: Q2 — confirmed. `approvePromotion` (resources.ts:342) runs a Drizzle transaction that does find-or-create resource + idempotent link inserts with `onConflictDoNothing`. It does NOT re-run the stale check inside the transaction, but it doesn't need to: the approval payload is fully self-contained (name/kind/occurrences), and the stale-check in the route handler already verified candidateKey still matches current suggestions. No silent corruption path in single-user SQLite.
- 적용: Q3 — confirmed. Thread.tsx line 456 guards `suggestions.length > 0` before rendering `PromotionSuggestionsPanel`. The `.map` at line 717 is inside that panel component and only runs when `suggestions.length > 0`. Empty `[]` renders as no panel — correct empty-state, no crash.
- 무시: (none)
