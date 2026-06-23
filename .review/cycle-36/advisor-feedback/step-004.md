# Step 004 — cycle-36 review-v1 resolution (4 issues)

Cycle: 36
Pass: 4
Files Changed:
- web/src/MirrorLedger.tsx
- shared/src/mirror.ts
- server/src/services/mirror-automation-needs.ts
- server/src/repositories/watchers.ts
- server/src/routes/watchers.ts
- docs/codebase-map.md
- (tests) quiet state masking, reasons rendering, 30-day cutoff boundary

## Advisor Verdict
PASS (one non-blocking gap)

## Advisor Feedback
Verification (cycle-36 review-v1, 4 issues):
1. Ran shared/server/web tests — 157 + 240 + 294 = 691 pass, clean.
2. Concern 1 (isEmpty): `&& !hasActionableAutomation` confirmed (MirrorLedger.tsx:65-72); quiet branch renders needs (135-137); EMPTY_AUTOMATION stub keeps quiet tests green.
3. Concern 2 (signature): cutoffDate param + Date.now() removed (watchers.ts:378-390); route derives logCutoff from date (routes/watchers.ts:52-59); insertWatcherLog stays observedAt-based — no impact.
4. Concern 3 (.strict()+reasons): reasons populated per reasonCode (mirror-automation-needs.ts:30-61); deterministic 30-day cutoff covered (watchers.integration.test.ts:300-340).

Gaps (non-blocking): No dedicated `MirrorAutomationNeedItemSchema.strict()` rejection test in shared/src/mirror.test.ts (only ledger/pattern/energy schemas have explicit strict tests). The item schema is exercised indirectly via service-built items. Concern 3's literal question — "do strict tests reject payloads missing reasons?" — has no direct test; consider adding one if the contract demands schema-level proof. All 691 tests pass clean.

## Sonnet Response
- 적용: 3 concerns 모두 PASS 확인. 691 tests clean.
- 적용 (gap): MirrorAutomationNeedItemSchema schema-level test 추가 — (a) reasons 누락 payload reject, (b) unknown key reject — `reasons` 계약을 직접 증명. shared/src/mirror.test.ts에 추가.
- 무시: 없음.
