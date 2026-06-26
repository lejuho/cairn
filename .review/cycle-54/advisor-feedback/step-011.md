# Step 011 — review-v1 ISSUE-1 fix confirmation (exact-kind evidence)

Cycle: 54
Pass: 4
Files Changed: server/src/services/threads.ts, server/src/routes/thread-missing-node-suggestions.integration.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
1. Correct. The trim is used only for the eligibility guard; the evidence lookup
passes raw `thread.kind` to `findCompletedThreadsByKind`, keeping
`eq(threads.kind, rawKind)` exact. Null-safety holds: kindTrimmed truthy implies
thread.kind non-null, and the explicit `thread.kind != null` guard makes it
provable for the type checker. Blank/done/dropped early-skip unchanged.
2. Scope contained. Only missingNodeSuggestions is affected; all other
ThreadDetail fields (events/tasks/progress/relations/rollup/nodeLinks/
unknownBlockers/settlement) untouched. Within cycle-54 FR-THR-08.

## Sonnet Response
- 적용: 1 — eligibility 가드엔 trim, evidence read엔 raw thread.kind 전달로 exact 매칭 복원. null 안전(kindTrimmed truthy → non-null, + `thread.kind != null` 가드)
- 적용: 2 — missingNodeSuggestions 외 ThreadDetail 필드/route shape 무영향, plan scope 내
- 무시: 없음
