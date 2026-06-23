# Step 003 — Approach check: Fix ISSUE-1 threadId scoping on approve

Cycle: 39
Pass: 3 (BLOCKED resolution)
Files Changed: shared/src/resources.ts, server/src/resources/promotion-suggestions.route.ts, apps/web/src/…/useResourcePromotionSuggestions.ts (or equivalent), integration test

## Advisor Verdict
PASS

## Advisor Feedback
1. Skip thread-existence validation on POST. GET already gates via `threadExists`; on approve, `threadId` is advisory scope only and occurrences are independently validated as existing targets — a stale/deleted threadId just yields fewer recomputed nodes, surfacing as STALE/NOT_ELIGIBLE, which is correct. Don't duplicate the 404 path.

2. Add `threadId: z.number().int().positive().optional()` at `shared/src/resources.ts:105` schema. Optional field is non-breaking — existing payloads omitting it still parse; `ApprovePromotionRequest` type gains an optional key. No other schema changes needed.

3. Server: change line 181 to `findCandidateSources(db, parsed.data.threadId)`. Frontend: add `threadId: id` to approve body.

4. Integration test: thread A (2 nodes "노트북") + thread B (1 node "노트북"); scoped GET A returns candidate; approve `threadId: A` succeeds; approve without `threadId` → 3 nodes, same key recomputed differs → expect `PROMOTION_STALE`.

Caution: verify `buildCandidateKey` incorporates occurrence set so global (3 nodes) vs scoped (2 nodes) keys actually diverge — else the without-threadId STALE expectation won't hold.

## Sonnet Response
- 적용: 1 — POST에서 threadId 존재 검증 생략 (advisory scope)
- 적용: 2 — `shared/src/resources.ts` line 105에 optional threadId 추가, non-breaking
- 적용: 3 — `findCandidateSources(db, parsed.data.threadId)` 로 변경, frontend approve body에 threadId 추가
- 적용: 4 — 통합 테스트 시나리오대로 작성
- 주의 적용: buildCandidateKey가 occurrence set을 포함하는지 확인 후 STALE 테스트 케이스 조건 결정
