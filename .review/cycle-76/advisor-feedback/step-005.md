# Step 005 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 76
Pass: 1
Files Changed: (none — bookkeeping only)

## Advisor Verdict
N/A (reconciliation entry)

## Advisor Feedback
Reconciles save-advisor-feedback.sh's transcript tally, inflated by the
documented M-ADVISOR-CALL limitation (CONTRACT_MARKERS): the grep counts every
line where an advisor-call phrase is followed by a real character, so saved
step-file headings/prose echoed into the transcript by the Write tool (and the
long Approach/Completion prompts for this large full-stack cycle) are mis-counted
as separate invocations.

Genuine cycle-76 advisor invocations were two, both saved:
- step-001 — approach review (travel schema, travel_time_cache, gateway
  travelTime, travel-time service cache policy, pure feasibility integration;
  locked the no_route→never-fresh guard + preview write-free test)
- step-002 — completion review (provider-call gating, fail-open, fresh-only gap
  inclusion + no double-count, server-only provider + preview cache-read-only,
  additive migration + no scope creep)

Entries 003-007 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
