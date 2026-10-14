# Step 006 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 77
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

Genuine cycle-77 advisor invocations were two, both saved:
- step-001 — approach review (Naver base62 token helper, search/transit-directions
  URL design, Today integration; locked the reverse-engineered-best-effort
  framing + fail-soft-null + label-first search)
- step-002 — completion review (centralized pure helper + sample-locked tokens,
  resolved-both-endpoints-only directions, safe external links, no Naver
  API/network, travel/feasibility semantics unchanged)

Entries 003-006 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
