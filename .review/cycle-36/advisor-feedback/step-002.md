# Step 002 — manual-exogenous B watcher + mirror automation-needs (Completion check)

Cycle: 36
Pass: 2
Files Changed:
- server/src/db/schema.ts (watcherLogs table)
- drizzle/0002_outgoing_spot.sql (migration)
- shared/src/watchers.ts (manual-exogenous schemas)
- shared/src/mirror.ts (automation-needs schemas)
- server/src/services/watcher-manual-exogenous.ts (NEW pure service)
- server/src/services/mirror-automation-needs.ts (NEW pure service)
- server/src/services/watcher-deep-view.ts (kind=B handling)
- server/src/repositories/watchers.ts (createManualExogenousWatcher, insertWatcherLog, findWatcherLogsInRange, findWatcherLogSummary)
- server/src/routes/watchers.ts (POST manual-exogenous, POST manual-log)
- server/src/routes/mirror.ts (GET automation-needs)
- web/src/Watchers.tsx (kind=B card + form + log buttons)
- web/src/MirrorLedger.tsx (automation-needs section)
- unit/integration/web tests

## Advisor Verdict
PASS

## Advisor Feedback
1. CONCERN 1: B early-returns at L102-121 (status:"quiet", threshold:null) before A path; disarmed L92 first, kind!=="A" L123 unreachable for B but catches other kinds — confirmed.
2. Sort tiebreak L255-258: `threshold ?? ""` then id. For two A rows neither is null, so both fall to identical (ta,tb)/id comparison as before B existed — A-vs-A pairwise key unchanged → relative order preserved.
3. B injects "" which sorts ahead of A quiet rows, but a stable A-vs-A comparator means no A row reorders relative to another A row → A ordering preserved.
4. CONCERN 2: L29 `.catch` → `{ok:false, data:undefined}`; L38 guards `ok && Array.isArray(data?.items)` before cast → cast only on validated shape, optional-chain safe on undefined → no unsafe deref.
5. CONCERN 3: insertWatcherLog L323 cutoff from `input.observedAt` (deterministic); findWatcherLogSummary L381 uses `Date.now()`.
6. Summary via Date.now() is time-dependent: rows pass filter only if `observedAt.slice(0,10) >= today-windowDays`. Fixed/recent observedAt within 30d stays in window across run dates → stable; a fixed PAST observedAt would silently drop out → latent flake if a test pins an old date.

VERDICT: PASS

## Sonnet Response
- 적용: CONCERN 1 — A-vs-A 정렬 불변식 보존 확인. B는 quiet 그룹에서 threshold ""로 A 앞에 정렬되지만, A 행끼리의 상대 순서는 (threshold, id) 비교가 동일해 변하지 않음. 추가 조치 불필요.
- 적용: CONCERN 2 — Array.isArray + optional-chain guard로 cast 안전. 변경 불필요.
- 적용 (감시): CONCERN 3 — 핵심 정정 확인됨. insertWatcherLog cutoff는 input.observedAt 기반(결정적). findWatcherLogSummary만 Date.now() 사용. 잠재 위험: 테스트가 30일보다 오래된 고정 과거 observedAt를 pin하면 summary window에서 silent drop → flake. 현재 테스트는 recent/fixed observedAt를 쓰므로 통과하나, 회귀 방어를 위해 summary 테스트의 observedAt가 항상 window 내(상대 날짜 또는 최근)인지 확인 권장. behavior 변경 아님 → 본 step 범위 내 코드 변경 없음.
- 무시: 없음.
