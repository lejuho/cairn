# Step 003 — review-v1 resolution approach (ISSUE-1/2/3, +4 docs)

Cycle: 36
Pass: 4
Files Changed: (pending) web/src/MirrorLedger.tsx, shared/src/mirror.ts, server/src/services/mirror-automation-needs.ts, server/src/routes/watchers.ts, server/src/repositories/watchers.ts, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
All seams confirmed. The route already destructures `date`/`now` and passes them to `buildWatcherDeepView`. `reasonCodes` is a clean derivation point for `reasons`.

Approach: sound. Recommend (b)+(a) for ISSUE-1, schema-side for ISSUE-2, precomputed-cutoff for ISSUE-3.

ISSUE-1
1. Extend `isEmpty` AND: `data.automationNeeds.items.every(i => i.level === "quiet")` → only-quiet B data stays quiet.
2. Also render `MirrorAutomationNeeds` inside quiet branch (defense for mixed-empty).
3. Web test: empty ledger/pattern/energy + one `watch`/`consider_lightweight` item → assert `mirror-automation-needs` present, not masked.

ISSUE-2
4. Add `reasons: z.array(z.string())` to `MirrorAutomationNeedItemSchema` (shared/mirror.ts:258), strict.
5. Map each `reasonCode`→Korean descriptive string in pure service `deriveItem`; non-prescriptive.
6. UI: render reasons + `/watch` link (MirrorLedger.tsx:323). Service + web tests.

ISSUE-3
7. Add `cutoffDate: string` param to `findWatcherLogSummary` (drop `Date.now()`).
8. Route computes cutoff from `now`/`date` anchor, passes in.
9. Integration test: fixed `date`, logs straddling 30-day boundary included/excluded deterministically.

Plus ISSUE-4: update codebase-map Watchers/Mirror UI sections.

Files: web/src/MirrorLedger.tsx, shared/src/mirror.ts, server/src/services/mirror-automation-needs.ts, server/src/routes/watchers.ts, server/src/repositories/watchers.ts, docs/codebase-map.md.

## Sonnet Response
- 적용: ISSUE-1 — (b)+(a) 둘 다. isEmpty 결정에 `automationNeeds.items.every(i => level==='quiet')` 조건 추가 + quiet 분기에도 MirrorAutomationNeeds 렌더(혼합-empty 방어). view tag 보존.
- 적용: ISSUE-2 — schema-side. `reasons: z.array(z.string())`를 MirrorAutomationNeedItemSchema에 strict 추가, pure service에서 reasonCode→한국어 descriptive 매핑으로 채움(non-prescriptive). UI에 reasons + `/watch` 링크 렌더.
- 적용: ISSUE-3 — precomputed cutoff seam. findWatcherLogSummary에 cutoffDate 파라미터 추가, route가 `date`/`now` 앵커에서 계산해 전달. Date.now() 제거.
- 적용: ISSUE-4 — codebase-map.md Watchers/Mirror UI 섹션 갱신.
- 무시: 없음.
