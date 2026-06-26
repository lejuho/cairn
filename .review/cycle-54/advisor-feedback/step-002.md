# Step 002 — Completion review: Thread Missing Node Suggestions A (cycle-54)

Cycle: 54
Pass: 2
Files Changed: shared/src/threads.ts(+test), server/src/repositories/threads.ts, server/src/services/thread-missing-node-suggestions.ts(+unit test), server/src/services/threads.ts, server/src/routes/thread-missing-node-suggestions.integration.test.ts, web/src/Thread.tsx(+test), docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. Read-only/eligibility-gated: SOUND. Three helpers are pure select (no write). getThreadDetail gates on kind && status not done/dropped before any evidence read. Service takes plain inputs, no DB/clock/random.
2. Direct-only evidence: CORRECT. Helpers filter WHERE thread_id IN (evidenceIds) — strictly each thread's own direct nodes, never contains-descendants. findCompletedThreadsByKind excludes current id (ne) and requires status='done' AND kind=kind.
3. Suppression + normalization: RIGHT. suppress from current events+tasks union (kind-agnostic); buildGroups skips non-done/blank; threadIds Set collapses per-thread → nodeCount==threadCount. Deterministic.
4. No-speculation: WITHIN INTENT. firmness/source literal soft/inferred; no date/order/sequence/score field; sort+slice(5) deterministic.
5. Scope: CLEAN. Other ThreadDetail fields passed through unchanged; UI read-only. No leftover risk.

## Sonnet Response
- 적용: 1 — 3개 read-only helper(pure select), getThreadDetail가 eligibility 가드 후 evidence read
- 적용: 2 — thread_id IN (ids)로 direct-only, contains-descendant 미포함; ne로 current 제외 + done + exact kind
- 적용: 3 — suppress는 current event/task union으로 kind 횡단, done+non-blank만, per-thread collapse
- 적용: 4 — soft/inferred literal, date/order/sequence/score 없음, 정렬/limit 결정론
- 적용: 5 — 기존 ThreadDetail 필드 무변경, UI zero-button read-only
- 무시: 없음
