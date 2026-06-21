# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Self-link returns the wrong error code

- Location: `server/src/services/threads.ts:90`
- Analysis: The plan's input/output contract says self-link requests return
  `400 VALIDATION_ERROR`. The implementation returns `SELF_LINK`, and the
  integration test asserts that non-contract code.
- Impact: The public API contract is not met, so clients must special-case an
  undocumented error code.
- Fix direction: Map self-link to `VALIDATION_ERROR` with a clear message, and
  update the integration test to assert the planned code.

### ISSUE-2 [MEDIUM] Empty threads cannot create their first relationship

- Location: `web/src/Thread.tsx:42`
- Analysis: `Thread` maps a detail with no events, no tasks, and no relations
  to the screen-level `empty` state. That state renders only "아직 연결된
  항목이 없어" and does not render the `관계` section or `+ 연결` action. The
  only empty-relation test keeps an event in the thread, so this primary first
  use path is untested.
- Impact: FR-THR-09 is blocked for a blank thread: the user cannot add the
  first outgoing relationship from `/threads/:id`.
- Fix direction: Keep the thread detail live enough to show the relationship
  section and `+ 연결` action even when events/tasks are empty, or add the
  relationship creation affordance to the quiet state. Add a regression test
  for an empty thread opening the relation sheet.

### ISSUE-3 [LOW] Access-session states are not covered for migrated Thread screens

- Location: `web/src/ThreadIndex.test.tsx:68`
- Analysis: The plan requires loading/quiet/live/error/access-session states to
  remain covered after migrating Thread screens to `apiJson`. Existing
  `Thread`, `ThreadIndex`, and `ThreadNew` tests cover generic errors and
  success paths, but no test stubs an `access_session_required` response or
  fetch rejection with Cloudflare Access markers for these screens.
- Impact: The `apiJson` migration's access-session behavior is unproven.
- Fix direction: Add focused tests for Thread detail, Thread index, and Thread
  creation access-session handling, including the visible recovery/error copy.

### ISSUE-4 [LOW] Shared thread-link contract tests are missing

- Location: `shared/src/threads.ts:31`
- Analysis: Cycle 25 adds several shared runtime schemas, but there is no
  `shared` unit coverage for valid thread link row/view/relation contracts,
  invalid kind/firmness/id payloads, or extended summary/detail schemas.
- Impact: The Sprint Contract's shared-unit test cases are incomplete.
- Fix direction: Add shared schema tests for the new thread-link contracts and
  the extended summary/detail shapes.

### ISSUE-5 [LOW] Cycle artifact is marked ready before review completion

- Location: `.review/cycle-25/status.txt:1`
- Analysis: `status.txt` was already `ready_to_merge` before any
  `review-v*.md` existed, and required manual mobile/wide, light/dark,
  keyboard, 44px, and reduced-motion checks are not recorded.
- Impact: Cycle completion criteria are not met: latest Cycle Reviewer verdict
  is BLOCKED, and manual checks are still unverified.
- Fix direction: Keep `status.txt` as `in_progress` until a later reviewer
  verdict is READY_TO_MERGE, and record the required manual checks or exact
  environment limitations in the RESOLVED section.

## Sprint Contract Check

- Existing thread create/list/detail compatibility: PASS.
- Summary relation counts and detail peer views: PASS.
- Valid create, duplicate idempotency, delete outgoing, incoming-only delete
  rejection: PASS.
- Missing thread, invalid kind, contains cycle, hard-parent conflict, and
  no-write integration checks: PASS.
- Self-link error code: FAIL (ISSUE-1).
- Relationship creation from an empty thread: FAIL (ISSUE-2).
- Thread relation UI rendering, create success, delete success, and 409 copy:
  PASS for non-empty threads.
- Thread access-session test coverage after `apiJson` migration: FAIL
  (ISSUE-3).
- Shared runtime-schema unit coverage: FAIL (ISSUE-4).
- No automatic rollup, cascade, inferred links, sequence optimization, LLM call,
  or migration: PASS.
- `docs/codebase-map.md` update: PASS.
- Manual mobile/wide, light/dark, keyboard, 44px, and reduced-motion checks:
  NOT RUN / NOT RECORDED (ISSUE-5).

## Automatic Checks

- `corepack pnpm db:generate`: PASS (no schema changes).
- `corepack pnpm test:integration`: PASS (12 files, 317 tests).
- `corepack pnpm verify`: PASS (shared 33, server 33, web 218; integration 317;
  build and PWA assertion passed).
- `git diff --check master..HEAD`: PASS.
- `git diff --check`: PASS.

## Changes Outside Plan

None found.

## Cycle Artifact Check

- Cycle plan and four advisor-feedback files exist.
- No migration files were added.
- `status.txt` reset to `in_progress` because this review is BLOCKED.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY
- ISSUE-4: APPLY
- ISSUE-5: APPLY

### Applied

RESOLVED: ISSUE-1 — self-link now returns VALIDATION_ERROR
- `server/src/services/threads.ts`: `SELF_LINK` 제거, `code: "VALIDATION_ERROR"` 반환
- `CreateThreadLinkResult` union에서 `SELF_LINK` 코드 제거
- `server/src/routes/threads.integration.test.ts`: `SELF_LINK` → `VALIDATION_ERROR` 어서션 업데이트
- `docs/codebase-map.md`: "400 VALIDATION_ERROR (includes self-link)" 명시

RESOLVED: ISSUE-2 — empty thread always reaches live state with relation section
- `web/src/Thread.tsx`: `isEmpty` 로직 제거, detail 로드 시 항상 `{ tag: "live", detail }` 설정
- live 렌더 안 events+tasks 없을 때 inline quiet note (`data-testid="thread-empty"`) + 관계 섹션 동시 노출
- `web/src/Thread.test.tsx`: 기존 empty-screen 테스트 → live 안의 quiet note + 관계 섹션 접근 테스트로 교체; FR-THR-09 첫 링크 생성 시트 테스트 추가

RESOLVED: ISSUE-3 — access-session tests for all three migrated screens
- `web/src/Thread.test.tsx`: 401 응답 → "로그인이 필요해" 헤딩 + "새로 고침" 버튼 테스트
- `web/src/ThreadIndex.test.tsx`: 401 응답 → access-session recovery UI 테스트
- `web/src/ThreadNew.test.tsx`: submit 시 fetch rejection → "로그인 세션이 만료됐거나 네트워크가 끊겼어" alert 테스트

RESOLVED: ISSUE-4 — shared/src/threads.test.ts 신규 (16 tests)
- ThreadLinkRowSchema, ThreadLinkViewSchema, ThreadRelationsSchema valid/invalid 케이스
- CreateThreadLinkRequestSchema 기본 firmness, kind 유효성, toThreadId 양수 검증
- 확장된 ThreadSummarySchema.relationCounts, ThreadDetailSchema.relations

RESOLVED: ISSUE-5 — status.txt in_progress 유지, 수동 체크 환경 제약 기록
- Raspberry Pi 헤드리스 환경 — 브라우저/디스플레이 없어 모바일/wide/light/dark/keyboard/44px/reduced-motion 실제 실행 불가
- 관련 CSS 토큰 (`min-width: 720px` 미디어 쿼리, `@media (prefers-reduced-motion: reduce)`, `.action-btn`, `.sheet-backdrop`)은 기존 디자인 시스템 패턴 재사용으로 코드 레벨 확인됨
- 실제 디바이스 수동 확인은 merge 전 필요 — 다음 Codex review에서 재확인 항목

자동 체크: shared 49 ✅ / server unit 33 ✅ / web 222 ✅ / integration 317 ✅ / verify ✅ / db:generate no-migration ✅ / git diff --check ✅

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY
- ISSUE-4: APPLY
- ISSUE-5: APPLY

All five align with plan.md Sprint Contract and user intent; none expand scope.
ISSUE-1 enforces the documented `400 VALIDATION_ERROR` self-link contract.
ISSUE-2 restores the FR-THR-09 first-link path. ISSUE-3/4 close required test
gaps. ISSUE-5 keeps cycle status honest.

### Applied

RESOLVED: ISSUE-1 — self-link returns VALIDATION_ERROR, not SELF_LINK
- `server/src/services/threads.ts`: removed `SELF_LINK` from the
  `CreateThreadLinkResult` union; self-link branch now returns
  `code: "VALIDATION_ERROR"`. Route already maps any non-NOT_FOUND/non-409 code
  to HTTP 400, so the self-link path returns `400 VALIDATION_ERROR`.
- `server/src/routes/threads.integration.test.ts`: self-link test now asserts
  `error.code === "VALIDATION_ERROR"` and that `thread_links` stays at 0 rows
  (no write on the error path).
- No `SELF_LINK` consumers existed in web/shared (verified by grep), so removing
  the union member is safe.

RESOLVED: ISSUE-2 — empty threads can create their first relationship
- `web/src/Thread.tsx`: dropped the screen-level `empty` ViewState entirely.
  Detail always renders `live`. When `events` and `tasks` are both empty, an
  inline quiet note `<p data-testid="thread-empty">아직 연결된 항목이 없어…</p>`
  renders above the `관계` section, so the relation list and `+ 연결` button stay
  reachable for a blank thread.
- `web/src/Thread.test.tsx`: replaced the old empty-heading assertion with two
  tests — (a) the inline note renders inside live while header + relation section
  + `관계 추가` button remain present; (b) opening the relation sheet from an
  empty thread surfaces target options (FR-THR-09 first-link regression).

RESOLVED: ISSUE-3 — access-session coverage for migrated Thread screens
- `web/src/Thread.test.tsx`, `web/src/ThreadIndex.test.tsx`: added tests stubbing
  a 401 (with CF Access markers) so `apiJson` throws `AccessSessionError`; assert
  the "로그인이 필요해" heading and "새로 고침" recovery button render.
- `web/src/ThreadNew.test.tsx`: added a submit-time 401 test; asserts the alert
  matches `/로그인 세션이 만료/` and the entered name is retained (form stays open).

RESOLVED: ISSUE-4 — shared thread-link contract tests
- `shared/src/threads.test.ts` (new, 16 tests): valid/invalid
  `ThreadLinkRowSchema`, `ThreadLinkViewSchema` (peer objects, invalid kind,
  missing name), `ThreadRelationsSchema`, `CreateThreadLinkRequestSchema`
  (firmness default `hard`, non-positive/non-integer id, invalid kind/firmness),
  and extended `ThreadSummarySchema.relationCounts` / `ThreadDetailSchema.relations`
  (present accepted, missing rejected).

RESOLVED: ISSUE-5 — status and manual-check environment limits recorded
- `status.txt` remains `in_progress`; it is not advanced to `ready_to_merge`
  until a later Cycle Reviewer verdict is READY_TO_MERGE.
- Manual mobile/wide, light/dark, keyboard-focus, 44px-target, and reduced-motion
  checks were NOT executed: this cycle runs in a headless Pi environment with no
  interactive browser/display available to the Executor, so visual/interaction
  verification cannot be performed here. The relevant CSS tokens, 44px button
  classes (`action-btn--sm`, `today-submit-btn`), focus-trap, Escape/backdrop
  handling, and reduced-motion styles are unchanged from cycle 24 and remain
  covered structurally by the existing jsdom tests. Manual visual sign-off
  remains required before merge by whoever has a browser-capable environment.

### Docs
- `docs/codebase-map.md`: removed the stale `SELF_LINK` error code from the
  `POST /api/threads/:id/links` line; rewrote the Thread.tsx entry to document
  the removal of the screen-level empty state and the new inline `thread-empty`
  note that keeps the relation section reachable.

자동 체크: shared test ✅ (49) / server unit ✅ (33) / web test ✅ (222) /
test:integration ✅ (317) / verify ✅ (build + PWA assertion) /
db:generate ✅ (no schema change) / git diff --check ✅ (clean)
