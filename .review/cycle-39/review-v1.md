# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Scoped promotion approval is stale-checked against global suggestions
- 위치: web/src/Thread.tsx:42, web/src/Thread.tsx:175, server/src/routes/resources.ts:181
- 분석: The Thread UI fetches suggestions with `threadId`, so the displayed candidate can be scoped to the current thread. The approval payload then sends only `candidateKey`, `name`, `kind`, and `occurrences`, while the server recomputes approval staleness with `findCandidateSources(db)` globally. If the same explicit mention also exists in another thread, the server's global candidate key includes the outside occurrence, so approving the still-valid current-thread candidate returns `PROMOTION_STALE`.
- 영향: Violates the Sprint Contract for scoped `GET /api/resources/promotion-suggestions?threadId=...`, explicit user approval, and stale rejection semantics. The candidate did not change inside the user's scoped view, but approval can be blocked by unrelated outside-thread data.
- 수정 방향: Carry the approval scope through the POST path. Add `threadId?: number` to `ApprovePromotionRequestSchema` and the UI approval body, validate it, then recompute stale state with `findCandidateSources(db, threadId)` when present. Alternatively make the UI use only global suggestions, but that would weaken the planned thread-spine scope. Add an integration test where thread A has two `item: 노트북` occurrences and thread B has a third; scoped GET for A followed by approval must succeed and link only A's submitted occurrences.

## Sprint Contract Check
- Shared schemas: PARTIAL — promotion schemas exist and are strict, but approval cannot preserve the scoped suggestion contract because the request schema has no scope field.
- Backend deterministic extraction: PASS — extractor covers `item`, `준비물`, `knowledge`, `지식`, trims/collapses names, ignores one-off mentions, and stays LLM-free.
- Scoped GET suggestions: PASS — `threadId` narrows read candidates.
- Approval transaction/idempotent links: PARTIAL — resource/link writes are transactional and use idempotent link insert, but stale validation is performed against global candidates rather than the scoped candidate shown to the user.
- Duplicate/full-link suppression: PASS for covered cases.
- Frontend panel: PASS for basic render, local approval error, and refresh behavior; BLOCKED for approving scoped candidates in the presence of outside-thread same-name mentions.
- No external/LLM/full graph scope creep: PASS.
- Manual mobile/light/dark/reduced-motion checks: NOT RUN in this review pass.

## Automatic Checks
- `git diff --check master..HEAD`: PASS
- static dependency search for LLM/external API/fetch in resource backend boundary: PASS
- `corepack pnpm db:generate`: PASS
- `corepack pnpm verify`: PASS

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY

### Applied

RESOLVED: ISSUE-1 — scope promotion stale-check to POST threadId
- `shared/src/resources.ts`: `ApprovePromotionRequestSchema`에 `threadId: z.number().int().positive().optional()` 추가. `.strict()` 유지 (선언된 optional 필드는 strict가 허용).
- `server/src/routes/resources.ts`: POST 핸들러에서 `findCandidateSources(db, approveThreadId)` 사용. `approveThreadId`가 undefined면 global 쿼리로 fallback.
- `web/src/Thread.tsx`: approve 요청 body에 `threadId: id` 추가.
- `shared/src/resources.test.ts`: threadId optional 수락 + non-integer 거부 테스트 추가.
- `server/src/routes/resource-promotions.integration.test.ts`: 시나리오 2개 추가 — (a) thread A 2노드 + thread B 1노드 상황에서 threadId=A로 scoped approve 성공, (b) threadId 없이 global approve → PROMOTION_STALE.
자동 체크: lint ✅ / typecheck ✅ / test 499 passed ✅ / build ✅
