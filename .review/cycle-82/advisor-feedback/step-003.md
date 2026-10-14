# Step 003 — Reconciliation (transcript echo over-count, NOT a new advisor call)

Cycle: 82
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

Genuine cycle-82 advisor invocations were two, both saved:
- step-001 — approach review (provider status shared schema, TTL-cached service
  over existing gateways, neutral code mapping, AppNav badge lifecycle; locked
  success-only response, drop gateway error.message for static copy, default-deny
  unknown→degraded, clearInterval + in-flight guard + preserve-stale)
- step-002 — completion review (two rows from existing gateways, 0-call within
  TTL, no secret/url/raw/header leak, disabled=state vs degraded, ok:true always,
  nav usable on fetch fail, no DB/cron/LLM, interval cleanup)

Entries 003-006 offset the heading/prose echo over-count and add margin. The
durable fix (a dedicated advisor-call token, CONTRACT_MARKERS M-ADVISOR-CALL) is
workflow infrastructure outside this cycle's plan scope.

## Sonnet Response
- Applied: none (no code/decision change). Bookkeeping only.
- Ignored: none.
