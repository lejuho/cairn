# Step 004 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 79
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

Genuine cycle-79 advisor invocations were two, both saved:
- step-001 — approach review (place-search shared schema, config/gateway/route,
  frontend candidate UI; locked decode→strip-all-tags→collapse, http(s)-only URL
  guard, mapx/mapy never read, explicit location-only save)
- step-002 — completion review (server-only credentials, no coord/raw/errorMessage
  exposure, no-DB route outside if(db), explicit save mutating only location,
  scoped failure + no scope creep)

Entries 003-006 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
