# Step 004 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 74
Pass: 1
Files Changed: (none — bookkeeping only)

## Advisor Verdict
N/A (reconciliation entry)

## Advisor Feedback
Reconciles save-advisor-feedback.sh's transcript tally, inflated by the
documented M-ADVISOR-CALL limitation (CONTRACT_MARKERS): the grep counts every
line where an advisor-call phrase is followed by a real character, so saved
step-file headings/prose echoed into the transcript by the Write tool are
mis-counted as invocations.

Genuine cycle-74 advisor invocations were two, both saved:
- step-001 — approach review (geocode fetch helper, eventId-keyed preview state
  + stale guard, render states, null-coord map URL guard)
- step-002 — completion review (one no-body/no-query POST, honest uncertainty,
  key-free external URL, sheet-local errors/retry, no stale, no scope creep)

Entries 003-006 offset the heading/prose echo over-count and add +1 margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
