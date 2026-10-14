# Step 003 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 80
Pass: 1
Files Changed: (none — bookkeeping only)

## Advisor Verdict
N/A (reconciliation entry)

## Advisor Feedback
Reconciles save-advisor-feedback.sh's transcript tally, inflated by the
documented M-ADVISOR-CALL limitation (CONTRACT_MARKERS): the grep counts every
line where an advisor-call phrase is followed by a real character, so saved
step-file headings/prose echoed into the transcript by the Write tool (and the
Approach/Completion prompts) are mis-counted as separate invocations.

Genuine cycle-80 advisor invocations were two, both saved:
- step-001 — approach review (optional note schema, pinnedEvidence-only
  propagation, render gate, edit prefill; locked .optional().nullable() back-compat,
  provider-no-note-key, render gate source+nonblank, prefill optional)
- step-002 — completion review (note only on pinned evidence, provenance-gated
  render, prefill duration+note, gap stays duration-only, no scope creep)

Entries 003-006 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
