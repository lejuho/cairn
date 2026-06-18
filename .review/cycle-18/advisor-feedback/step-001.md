# Step 001 — Approach check: decision conflict (backend + frontend)

Cycle: 18
Pass: 2
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. Suggestion score: null-safe additive ordering, treating absent numerics as 0 — but map `cancel_effort` (text enum, not numeric) and keep an all-unknown flag so 0-vs-unknown does not fake a suggestion. Reason: plan requires no suggestion on all-zero/unknown.
2. Stale check: single transaction wrapping requery+overlap recheck+update+insert. Reason: two selects reopen the race the 409 exists to close; better-sqlite3 is synchronous so a txn is cheap.
3. Annotation insert: reuse the repository, adding a narrow structured-insert helper. Reason: existing helpers do not cover one-shot ledger insert; inline route SQL breaks the repo boundary.

Overall verdict: NEEDS_REVIEW — point 1 as stated ("sum cancel_* numerics") is unsafe: `cancel_effort` is a text enum and a naive null→0 sum cannot distinguish known-zero from unknown, which the no-suggestion rule depends on. Points 2 and 3 are sound.

## Sonnet Response
- 적용 (point 1): cancel_effort is a text enum, not a numeric — map it to an ordinal before scoring rather than summing raw. Treat absent numerics as 0 for ordering, but carry an "any known value" flag so an all-unknown pair yields NO suggestion (do not collapse known-0 and unknown to the same 0).
- 적용 (point 2): wrap requery + overlap recheck + status update + annotation insert in a single better-sqlite3 transaction; return 409 CONFLICT_STALE inside the txn if overlap no longer holds. Two separate selects reopen the stale race the 409 guards against.
- 적용 (point 3): reuse the repository boundary; add a narrow structured-insert helper (existing insertRawAnnotation/updateAnnotationStructured do not cover a one-shot ledger insert). No inline SQL in the route.
- 무시: 없음.
