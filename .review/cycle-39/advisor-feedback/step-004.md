# Step 004 — Completion check: ISSUE-1 fix — ApprovePromotionRequest threadId scope

Cycle: 39
Pass: 2
Files Changed:
- shared/src/resources.ts (ApprovePromotionRequestSchema)
- server/src/routes/resources.ts (POST handler)
- server/src/routes/resource-promotions.integration.test.ts (global STALE test)

## Advisor Verdict
PASS

## Advisor Feedback
1. Schema OK: resources.ts:111 — `threadId` is a declared optional field, so `.strict()` accepts-when-present / absent-when-omitted. No conflict.
2. Repo OK: resources.ts:220 — `if (threadId != null)` falls through to global on `undefined`. Correct.
3. STALE detection deterministic: global 3-node key vs scoped 2-node key differ by construction (serial IDs in insert order + pure string sort). Structurally guaranteed.

Verdict: No regressions. Implementation correct.
One note: client omitting threadId on approve means recompute always uses global scope — intended STALE-guard behavior, not a bug, but confirm that is the design intent.

## Sonnet Response
- 적용: 세 항목 모두 확인. threadId 없는 approve → global scope recompute는 설계 의도 맞음 (review-v1.md ISSUE-1 fix의 핵심 STALE-guard 동작).
- 무시: 없음.
