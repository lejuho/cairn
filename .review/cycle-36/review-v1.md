# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Automation-needs can be hidden by Mirror quiet state

- Location: `web/src/MirrorLedger.tsx:65`
- Analysis: `/mirror` decides quiet/live using only `patterns.totals.annotations`
  and `energy.summary.scheduledDays`. `automationNeeds.items` is ignored in
  the state decision. If a user has only manual B watcher logs and no mirror
  ledger/pattern/energy data, the screen enters the quiet branch and returns
  before rendering `MirrorAutomationNeeds`.
- Impact: Violates the plan requirement to show the "자동화 필요 신호" section.
  This is the core FR-MIR-05 surface for this cycle, and the most likely fresh
  manual-B data state can be invisible.
- Fix direction: Include actionable automation-needs items in the live/quiet
  decision, or render the automation-needs section in the quiet branch as well.
  Add a web test where ledger/pattern/energy are empty but automation-needs has
  a `watch` or `consider_lightweight` item, and assert `mirror-automation-needs`
  renders and `mirror-quiet` does not mask it.

### ISSUE-2 [MEDIUM] Automation-needs output lacks human-readable reasons and `/watch` link

- Location: `shared/src/mirror.ts:258`, `server/src/services/mirror-automation-needs.ts:57`, `web/src/MirrorLedger.tsx:323`
- Analysis: `MirrorAutomationNeedItemSchema` exposes `reasonCodes` only. The
  service returns no human-readable `reasons`, and the UI card renders only
  counts/miss rate. The card also has no link back to `/watch`.
- Impact: Violates the output contract that each item includes `reasonCodes`
  plus human-readable technical reasons, and the frontend contract that the
  automation-needs section links back to `/watch`. The current UI shows a label
  like "자동화 검토" without the required explanatory bridge.
- Fix direction: Add `reasons: string[]` (or equivalent descriptive field) to
  the shared schema and pure service, keep it descriptive/non-prescriptive, and
  render those reasons in the card. Add a `/watch` link for the watcher row or
  section. Cover service schema and web rendering in tests.

### ISSUE-3 [MEDIUM] `/watch` manual B summary ignores requested date/now

- Location: `server/src/routes/watchers.ts:51`, `server/src/repositories/watchers.ts:375`
- Analysis: `GET /api/watchers?date&now` builds manual-exogenous summaries by
  calling `findWatcherLogSummary(db, row.id)` with no route date/now. The
  repository uses `Date.now()` to choose the 30-day cutoff. Existing watcher
  deep-view behavior is date/now-driven, but manual B counts vary with wall
  clock time instead of the request's `date` or `now`.
- Impact: Violates deterministic route behavior and can make `/watch` show
  wrong counts for historical/future query dates. It also creates a future test
  flake: fixed observedAt values silently fall out of the 30-day window as real
  time advances.
- Fix direction: Anchor summary cutoff to `date` or `now` from the route and
  pass it into the repository. Add an integration test where `date` is fixed
  and logs around the 30-day boundary are included/excluded deterministically.

### ISSUE-4 [LOW] `docs/codebase-map.md` omits the new `/watch` manual-exogenous UI

- Location: `docs/codebase-map.md:333`
- Analysis: The server map documents manual-exogenous routes and the corrected
  reverse-plan response shape, but the `web/src/Watchers.tsx` section still says
  the create sheet has only two modes: date-threshold and reverse-plan. It does
  not mention the new "수동 확인" create mode, B card source/stability summary,
  or manual log buttons.
- Impact: Violates the plan docs requirement to update codebase-map with the
  manual-exogenous UI section. Future cycles will look in the wrong place or
  miss the new route/card behavior.
- Fix direction: Update the Watchers web map entry to include the third create
  mode, manual B card fields, and the three log actions. Include Mirror
  automation-needs UI details if not already covered.

## Sprint Contract Check

- Manual B watcher creation persists `kind='B'`, `armed=1`, `threshold=null`,
  and strict `manual_exogenous` rule JSON: PASS.
- Manual B watcher appears in `/watch` and never appears in Today or daily push
  in this cycle: PASS.
- Manual log insert is transactional and only allowed for manual-exogenous
  watchers: PASS by route/repository tests.
- Invalid injected fields are rejected by shared schemas and routes: PARTIAL.
  Watcher create/log schemas are strict; automation-needs item reasons contract
  is incomplete; see ISSUE-2.
- Mirror automation-needs derives levels deterministically from logs and source
  stability: PASS for pure service; `/watch` summary route is not deterministic;
  see ISSUE-3.
- Cold-start and volatile-source cases never overstate automation readiness:
  PASS.
- Mirror output contains reasons and requires no confirmation/action mutation:
  FAIL, see ISSUE-2.
- No LLM, GCal, Gmail, crawler, n8n, fetch, or external network dependency is
  introduced: PASS for server/shared new paths.
- Existing date-threshold, reverse-plan, Today watcher bubbles, and daily push
  behavior remain compatible: PASS by full verify.
- `docs/codebase-map.md` updated and stale reverse-plan response shape fixed:
  PARTIAL. Reverse-plan response is fixed; Watchers UI map is stale; see
  ISSUE-4.
- `/mirror` shows automation-needs section: FAIL in the empty-ledger quiet path;
  see ISSUE-1.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes after migration
- Static boundary check for LLM/GCal/Gmail/crawler/n8n/fetch imports in new
  server/shared manual-exogenous and automation-needs paths: PASS, no hits
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 157 PASS
  - server unit tests: 240 PASS
  - web unit tests: 289 PASS
  - shared build: PASS
  - server SQLite integration tests: 446 PASS
  - production build/PWA generation: PASS

## Changes Outside Plan

None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY
- ISSUE-4: APPLY

### Applied

RESOLVED: ISSUE-1 — quiet branch이 actionable automation items 있을 때 live로 전환
- `isEmpty` 조건에 `!hasActionableAutomation` 추가 (watch/consider_lightweight 항목 존재 시 live)
- quiet branch에도 `MirrorAutomationNeeds` 렌더 추가 (defense layer)
- web 테스트: "mirror-quiet does NOT mask automation-needs", quiet-only items stays quiet

RESOLVED: ISSUE-2 — `reasons: string[]` 필드 추가 + UI 렌더 + `/watch` link
- `shared/src/mirror.ts`: `MirrorAutomationNeedItemSchema`에 `reasons: z.array(z.string())` 추가
- `server/src/services/mirror-automation-needs.ts`: reasonCode별 한국어 설명 문자열 생성
- `web/src/MirrorLedger.tsx`: reasons 목록 렌더, 섹션 헤더에 "여백 →" `/watch` 링크
- `shared/src/mirror.test.ts`: Advisor가 schema-level 4개 테스트 추가 (accepts full item, rejects missing reasons, rejects non-string entry, rejects injected field)

RESOLVED: ISSUE-3 — `findWatcherLogSummary` cutoff를 route의 `date` 파라미터에 anchoring
- `server/src/repositories/watchers.ts`: `cutoffDate: string` 파라미터 추가, `Date.now()` 제거
- `server/src/routes/watchers.ts`: `logCutoff = date - 30days` 계산 후 전달
- integration test: 30일 경계 포함/제외 결정론 테스트 추가

RESOLVED: ISSUE-4 — codebase-map.md Watchers/MirrorLedger UI 섹션 업데이트
- Watchers.tsx: 세 번째 create mode "수동 확인", kind=B 카드 필드, 3종 log 버튼 명시
- MirrorLedger.tsx: automation-needs fetch, isEmpty 로직, reasons/link 동작 명시

자동 체크: verify ✅ (161+240+294 = 695 tests pass)
