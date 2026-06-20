# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [HIGH] Resolved conflict sheet lacks defined layout and modal accessibility

- Location: `web/src/Today.tsx:332`
- Analysis: The new resolved state uses `.sheet-overlay` and `.sheet-panel`, but
  neither selector exists in `web/src/styles.css`. It also adds no inert
  background, focus trap, opener focus restore, or Escape handling.
- Impact: The primary Cycle 24 result can render without intended sheet layout
  and violates the Sprint Contract's modal accessibility requirements.
- Fix direction: Use the established backdrop/sheet structure or define the
  missing semantic-token styles. Add inert background, initial focus, Tab wrap,
  Escape/close behavior, and opener focus restore with component tests.

### ISSUE-2 [MEDIUM] Resolved result discards the changed event

- Location: `web/src/Today.tsx:20`
- Analysis: `ConflictSheetState` stores only outcome and drafts after success.
  `ConflictResolvedSheet` therefore renders `충돌 해결됨 — 이동/취소` without
  the changed event title.
- Impact: The explicit UI contract requires changed event plus outcome, so the
  user cannot tell which event the drafts describe.
- Fix direction: Preserve typed `changedEvent` from the resolve response and
  render its title with the outcome in the resolved sheet. Add exact tests for
  moved and cancelled results.

### ISSUE-3 [MEDIUM] Missing resolve data is converted into a false successful empty state

- Location: `web/src/Today.tsx:629`
- Analysis: The success payload models `data` as optional and line 642 falls
  back to `notificationDrafts ?? []`. A malformed/legacy response can therefore
  display "연결된 사람이 없어" despite missing required response data.
- Impact: Shared `ResolveConflictResponseDataSchema` is not the runtime source
  of truth, and contract failure is misreported as valid no-person state.
- Fix direction: Validate success data with the shared schema (or a shared API
  response schema), require `changedEvent`, `annotation`, and
  `notificationDrafts`, and retain conflict controls with a local error when
  validation fails. Add shared response and frontend malformed-response tests.

### ISSUE-4 [MEDIUM] Missing Clipboard API throws outside local error handling

- Location: `web/src/Today.tsx:321`
- Analysis: `navigator.clipboard.writeText` is called directly. In an insecure
  or unsupported context `navigator.clipboard` is undefined, causing a
  synchronous exception before the Promise `.catch` runs.
- Impact: Draft copy can crash the interaction instead of preserving the draft
  and showing `복사 실패`, contradicting the explicit fallback contract.
- Fix direction: Guard Clipboard API availability and wrap invocation in
  `try/catch` plus `Promise.resolve`; map both synchronous absence/errors and
  rejected writes to the per-draft error state. Add missing-API coverage.

### ISSUE-5 [MEDIUM] Resolve transaction crosses repository boundary through an unchecked cast

- Location: `server/src/routes/decisions.ts:105`
- Analysis: The Drizzle transaction is forced through `tx as CairnDatabase` to
  call `findEventPeopleFullProfiles`. This hides the real executor contract and
  violates the backend no-unchecked-cast rule.
- Impact: Future database API changes can compile while transaction behavior is
  unsound; the critical rollback path depends on a type assertion rather than a
  checked repository boundary.
- Fix direction: Type the repository helper against the minimal shared
  select-capable executor or the actual Drizzle transaction type. Remove the
  cast and prove route/service typecheck plus transaction integration tests.

### ISSUE-6 [LOW] Draft service and tests do not fully prove ordering/reason contracts

- Location: `server/src/services/notification-drafts.ts:15`
- Analysis: Lead-time early returns emit only one unknown reason when both
  lead time and event time are unknown. The service preserves caller order
  rather than enforcing name/id order, while its test is named as an ordering
  test but asserts only ID membership. Template tests use partial string checks,
  not exact equality.
- Impact: Canonical reason completeness, pure-service deterministic order, and
  exact templates required by the Sprint Contract are not fully guaranteed.
- Fix direction: Collect every applicable reason in canonical order, sort
  deduplicated people by name/id inside the pure service, and assert exact
  templates, combined unknown reasons, same-name ID ties, and full order.

### ISSUE-7 [LOW] Codebase map remains stale and omits the Today draft surface

- Location: `docs/codebase-map.md:117`
- Analysis: Resolve route documentation still says update+annotation only,
  Cycle 23 profile schema is still described as shape-only validation, and the
  Today entry does not catalog the post-resolution notification draft UI.
- Impact: The plan's required map corrections/update are incomplete, weakening
  first-search navigation.
- Fix direction: Correct resolve output/transaction behavior, shared profile
  refinements, and Today resolved-draft/copy ownership in the map.

## Sprint Contract Check

- Existing resolve validation/error/status/annotation behavior: PASS.
- Drafts generated inside transaction from changed-event people: PASS.
- No people/one person/multiple people integration behavior: PASS.
- Channel/lead-time/tone basic honesty: PASS.
- Canonical combined reasons and pure-service ordering: FAIL (ISSUE-6).
- Today post-success draft visibility and delayed refetch: PASS.
- Changed-event identification: FAIL (ISSUE-2).
- Clipboard rejection: PASS; unavailable/synchronous failure: FAIL (ISSUE-4).
- Shared success-response runtime validation: FAIL (ISSUE-3).
- Sheet layout/accessibility/focus contract: FAIL (ISSUE-1).
- Checked transaction repository typing: FAIL (ISSUE-5).
- No automatic delivery, persistence, LLM, or migration: PASS.
- `docs/codebase-map.md` accuracy: FAIL (ISSUE-7).
- Manual mobile/wide, light/dark, clipboard HTTPS, keyboard, and reduced-motion:
  NOT RUN.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (no schema changes).
- `corepack pnpm test:integration`: PASS (12 files, 302 tests).
- `corepack pnpm verify`: PASS (shared 33, server 22, web 201; integration 302;
  build and PWA assertion passed).
- `git diff --check`: PASS for tracked changes.

## Changes Outside Plan

None found.

## Cycle Artifact Check

- `plan.md`, `status.txt`, and `advisor-feedback/step-001.md` remain untracked.
  They must be included before merge.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY
- ISSUE-4: APPLY
- ISSUE-5: APPLY
- ISSUE-6: APPLY
- ISSUE-7: APPLY

### Applied

RESOLVED: ISSUE-1 — ConflictResolvedSheet이 기존 `.sheet-backdrop`/`.bottom-sheet` CSS 재사용 + inert/focus trap/Escape/opener-restore 구현
- `web/src/Today.tsx`: `.sheet-overlay`/`.sheet-panel` → `.sheet-backdrop` + `bottom-sheet` 교체. sentinel div pair로 focus trap. Escape keydown handler. `useEffect` cleanup으로 opener focus restore. `inert` prop on main element while resolved sheet open.
자동 체크: typecheck ✅ / web test 203 ✅ / verify ✅

RESOLVED: ISSUE-2 — resolved state에 `changedEvent: EventRow` 추가, sheet 헤더에 이벤트 제목 렌더
- `web/src/Today.tsx`: `ConflictSheetState` resolved variant에 `changedEvent` 추가. `ConflictResolvedSheet` prop 추가 및 `{changedEvent.title} — {outcomeLabel}` 헤더 렌더.
자동 체크: typecheck ✅ / web test 203 ✅

RESOLVED: ISSUE-3 — `ResolveConflictResponseDataSchema`로 성공 데이터 runtime 검증
- `web/src/Today.tsx`: 성공 body.data를 `ResolveConflictResponseDataSchema.safeParse()`로 검증. 실패 시 충돌 sheet 유지 + "서버 응답이 예상과 달라" 에러. malformed-response 테스트 추가.
자동 체크: web test 203 ✅

RESOLVED: ISSUE-4 — `navigator.clipboard` undefined guard + Promise.resolve chain
- `web/src/Today.tsx`: `if (!clip) { setCopyStates error; return }` 동기 guard 추가. `Promise.resolve().then(clip.writeText).then(copied).catch(error)` 체인. clipboard undefined 커버 테스트 추가.
자동 체크: web test 203 ✅

RESOLVED: ISSUE-5 — `tx as CairnDatabase` cast 제거, `CairnDbExecutor` union 타입 도입
- `server/src/db/index.ts`: `CairnDbExecutor = CairnDatabase | BetterSQLiteTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>` 추가.
- `server/src/repositories/people.ts`: `findEventPeopleFullProfiles` 파라미터 `CairnDatabase` → `CairnDbExecutor`.
- `server/src/routes/decisions.ts`: `tx as CairnDatabase` cast 제거.
자동 체크: typecheck ✅ / integration 302 ✅

RESOLVED: ISSUE-6 — 서비스 내부 name/id sort, 복합 unknown reason 수집, exact template assertion
- `server/src/services/notification-drafts.ts`: `classifyLeadTime` 전면 재작성 — lead_time_unset + event_time_unknown 독립 수집, 이후 `codes.length > 0`이면 unknown 반환. `buildNotificationDrafts`에 Map dedup → sort(name, id) → map 변환.
- `server/src/services/notification-drafts.test.ts`: exact template 테스트, same-name ID tie, dedup+sort 내부 검증, combined unknown reason 테스트 추가.
자동 체크: server test 25 ✅

RESOLVED: ISSUE-7 — codebase-map.md 업데이트
- `docs/codebase-map.md`: resolve route 설명에 notification-drafts 포함 명시. UpdatePersonProfileRequestSchema cross-field refinement 서술 수정. Today conflict sheet 항목에 post-resolve notification draft sheet UI 추가.
자동 체크: verify ✅
