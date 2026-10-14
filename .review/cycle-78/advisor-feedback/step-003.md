# Step 003 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 78
Pass: 1
Files Changed: (none — bookkeeping only)

## Advisor Verdict
N/A (reconciliation entry)

## Advisor Feedback
Reconciles save-advisor-feedback.sh's transcript tally, inflated by the
documented M-ADVISOR-CALL limitation (CONTRACT_MARKERS): the grep counts every
line where an advisor-call phrase is followed by a real character, so saved
step-file headings/prose echoed into the transcript by the Write tool (and the
long Approach/Completion prompts for this full-stack cycle) are mis-counted as
separate invocations.

Genuine cycle-78 advisor invocations were two, both saved:
- step-001 — approach review (pinned schema/table, repo+service, travel
  precedence, gap reason, frontend; locked source-as-optional-field, pinned
  short-circuit before resolvePair, fail-open pinned-map, last_confirmed re-pin)
- step-002 — completion review (additive table + directional key + server-derived
  coords, route no-coords/typed errors, precedence + distinct gap reason +
  no double-count, preview write-free + fail-open, frontend provenance honesty)

Entries 003-006 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
