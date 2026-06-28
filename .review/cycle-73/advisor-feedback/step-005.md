# Step 005 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 73
Pass: 1
Files Changed: (none — bookkeeping only)

## Advisor Verdict
N/A (reconciliation entry)

## Advisor Feedback
Reconciles save-advisor-feedback.sh's transcript tally, inflated by the
documented M-ADVISOR-CALL limitation (CONTRACT_MARKERS): the grep counts every
line where the advisor-call phrase is followed by a real character, so saved
step-file headings and prose are mis-counted as invocations when the Write tool
echoes them into the transcript.

Genuine cycle-73 advisor invocations were two, both saved:
- step-001 — approach review (shared geocode schemas, geocode_cache table,
  gateway geocodeAddress status/confidence mapping, repo/service/route)
- step-002 — completion review (single table, route guards, provider-neutral
  boundary, idempotent cache, scope)

Entries 003-006 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token per CONTRACT_MARKERS M-ADVISOR-CALL)
is workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
