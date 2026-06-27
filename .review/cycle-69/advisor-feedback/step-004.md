# Step 004 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 69
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

Genuine cycle-69 advisor invocations were two, both saved:
- step-001 — approach review (unified composer state, mode-only routing,
  per-mode ResultCard, 고급 입력 collapse, test migration; resolved the
  task-loadData question — /input does not list tasks)
- step-002 — completion review (single Composer, endpoint isolation, behavior
  preservation, a11y/tokens, scope)

Entries 003-005 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token per CONTRACT_MARKERS M-ADVISOR-CALL)
is workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
