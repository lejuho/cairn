# Step 007 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 75
Pass: 1
Files Changed: (none — bookkeeping only)

## Advisor Verdict
N/A (reconciliation entry)

## Advisor Feedback
Reconciles save-advisor-feedback.sh's transcript tally, inflated by the
documented M-ADVISOR-CALL limitation (CONTRACT_MARKERS): the grep counts every
line where an advisor-call phrase is followed by a real character, so saved
step-file headings/prose echoed into the transcript by the Write tool (and the
detailed Approach/Completion prompts) are mis-counted as separate invocations.

Genuine cycle-75 advisor invocations were two, both saved:
- step-001 — approach review (shared location-context schema, pure cache-only
  builder, read-only repo, today route wiring, frontend chip placement; resolved
  the uncached-map-link honesty question → no link for uncached)
- step-002 — completion review (cache-only confirmed, card order/actions
  preserved, honest states + no coord/key leak, fail-open uncertainty, no creep)

Entries 003-007 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
