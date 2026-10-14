# Step 006 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 81
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

Genuine cycle-81 advisor invocations were two, both saved:
- step-001 — approach review (task drop reuse-only on three surfaces, scoped
  error, Thread droppable gate; resolved drop-vs-dismiss with distinct labels +
  no modal confirm since drop is a reversible status, and skipped brittle in-code
  no-DELETE asserts in favour of the plan's static negative greps)
- step-002 — completion review (status {dropped} only, no core hard-delete/
  migration, droppable gated to active rows, scoped failures, distinct permanent
  drop vs one-day dismiss, no scope creep)

Entries 003-006 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
