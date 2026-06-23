# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Reverse-plan input schema is not strict and overflow dates are not returned as validation errors

- Location: `shared/src/watchers.ts:43`, `shared/src/watchers.ts:48`, `server/src/routes/watchers.ts:94`, `server/src/services/watcher-reverse-plan.ts:40`
- Analysis: `ReversePlanStepInputSchema` and `CreateReversePlanWatcherRequestSchema` use default `z.object(...)` behavior, so injected fields such as `score`, `recommendation`, or automatic-action flags are stripped and accepted instead of rejected. `targetDate` is only regex-checked in the request schema; an overflow date such as `2026-02-30` reaches `createReversePlanWatcher`, then the route maps the thrown validation failure to `DB_ERROR`.
- Impact: Violates the plan's validation contract: strict schemas must reject injected recommendation/certainty/action fields, overflow dates must be rejected, and invalid input must return a stable validation error.
- Fix direction: Add `.strict()` to the reverse-plan request, step, stored-data, and view schemas as appropriate. Add a shared/server calendar-date refine for `targetDate`, or map pure compute validation failures to `VALIDATION_ERROR` before the DB/repository catch path. Add tests for injected fields and overflow dates through the shared schema and POST route.

### ISSUE-2 [MEDIUM] Today and daily push messages do not use reverse-plan-specific copy

- Location: `server/src/services/watchers.ts:103`, `server/src/services/watcher-daily-push.ts:118`
- Analysis: Reverse-plan rows can surface through the same threshold derivation, but the Today bubble still emits generic `date_threshold_due` copy via `bubbleMessage(overdue)`. The daily push digest prints only watcher label/category/threshold and generic overdue text. Neither output includes the next reverse-plan step label or the requested reverse-plan wording.
- Impact: Violates the Today/daily push output contract: messages should remain descriptive for reverse planning, for example "여권 신청을 시작할 때야" and "N일 지난 역산 watcher야".
- Fix direction: Carry reverse-plan view/next-step metadata into the Today bubble and push item builders, or add a shared helper that derives reverse-plan-specific message text from the next incomplete step. Add Today and push tests that assert the generated message contains the next step label and reverse-plan overdue wording.

### ISSUE-3 [LOW] POST response shape does not match the planned API contract

- Location: `server/src/repositories/watchers.ts:93`, `server/src/repositories/watchers.ts:206`, `server/src/routes/watcher-reverse-plan.integration.test.ts:204`
- Analysis: The route returns the repository result with `taskIds`, `targetTaskId`, and `linkIds`. The plan requires `{ watcher, tasks, links, reversePlan }`, and the current integration test locks in the ID-only shape.
- Impact: Violates the output spec for `POST /api/watchers/reverse-plan`; callers cannot inspect the generated task/link records promised by the contract.
- Fix direction: Return the inserted task and link rows, or transform the route response to `{ watcher, tasks, links, reversePlan }`. Update integration tests to assert the planned response shape and the computed chain returned to clients.

### ISSUE-4 [LOW] Required rollback/snooze reverse-plan coverage is missing

- Location: `server/src/routes/watcher-reverse-plan.integration.test.ts:42`, `server/src/routes/watcher-reverse-plan.integration.test.ts:235`
- Analysis: Integration coverage verifies successful atomic creation and link direction, but there is no failure-injection test proving that a generated link insert failure rolls back watcher and task rows. The reverse-plan Today coverage also checks due, disarmed, and completed paths, but not an actively snoozed reverse-plan watcher.
- Impact: Leaves two explicit Sprint Contract cases unverified: generated link failure rollback, and snoozed reverse-plan rows staying hidden from Today/push until the snooze expires.
- Fix direction: Add a SQLite integration test that forces a link insert failure inside reverse-plan creation and asserts no watcher/task/link rows remain. Add reverse-plan-specific snooze tests for `/api/today` and `selectDueForPush` or the daily push boundary.

## Sprint Contract Check

- Reverse-plan watcher creation is atomic: PARTIAL. Uses a DB transaction, but rollback-on-link-failure test is missing; see ISSUE-4.
- Generated link direction is exactly downstream `requires` upstream: PASS.
- Latest safe dates are computed by walking backward from `targetDate`: PASS.
- `safetyDays` only subtracts from the first actionable step: PASS.
- Date overflow and malformed dates are rejected or classified unsupported, never silently normalized: PARTIAL. Pure compute rejects overflow, but POST overflow currently reaches the repository catch and is returned as `DB_ERROR`; see ISSUE-1.
- `/watch` lists reverse-plan watchers with target, next step, latest safe date, and chain details: PASS by implementation and web tests.
- Disarmed reverse-plan watchers remain visible in `/watch` but do not appear in Today or daily push: PASS for Today; push compatibility covered by shared selection behavior.
- Snoozed reverse-plan watchers show `snoozed` in `/watch` and stay hidden from Today/push until expiry: PARTIAL. Behavior likely follows existing watcher code, but reverse-plan-specific Today/push tests are missing; see ISSUE-4.
- Completed reverse-plan chains stay visible in `/watch` as completed/quiet and do not surface as due: PASS.
- Existing date-threshold watcher behavior, Today watcher bubbles, and daily push digest remain compatible: PASS by full verify.
- No LLM, GCal, Gmail, external crawling, n8n, or network dependency is introduced: PASS by static boundary check.
- `docs/codebase-map.md` updated: PASS.
- `POST /api/watchers/reverse-plan` returns `{ watcher, tasks, links, reversePlan }`: FAIL, see ISSUE-3.
- Today and daily push messages are reverse-plan descriptive: FAIL, see ISSUE-2.
- Shared strict schemas reject injected recommendation/certainty/action fields: FAIL, see ISSUE-1.
- Manual mobile/light/dark/reduced-motion evidence for UI changes: NOT RUN / not found in cycle artifacts.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- Static boundary check for LLM/GCal/Gmail/crawler/n8n imports in the reverse-plan watcher path: PASS, no hits
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 149 PASS
  - server unit tests: 225 PASS
  - web unit tests: 282 PASS
  - server SQLite integration tests: 425 PASS
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

RESOLVED: ISSUE-1 — strict schemas + overflow date → VALIDATION_ERROR
- `shared/src/watchers.ts`: `.strict()` added to `ReversePlanStepInputSchema`, `CreateReversePlanWatcherRequestSchema`, `ReversePlanStepDataSchema`, `ReversePlanDataSchema`, `ReversePlanViewStepSchema`, `ReversePlanViewSchema`
- `CreateReversePlanWatcherRequestSchema.targetDate`: `.refine(isCalendarDate)` — "2026-02-30" 등 overflow 거부
- 스키마 `safeParse`가 먼저 실패하므로 라우트가 VALIDATION_ERROR 반환. repository 미도달.
- `WatcherReasonCodeSchema`: `"reverse_plan_due"` 추가
- Tests: shared/src/watchers.test.ts에 strict 거부 + overflow 거부 7개 테스트 추가

RESOLVED: ISSUE-2 — Today/push 역산 watcher 메시지에 다음 단계 label 포함
- `server/src/services/watchers.ts`: `resolveThresholdAndView` (view 반환 추가), `reversePlanBubbleMessage` 함수 추가. 역산 watcher는 "여권 신청을 시작할 때야" / "N일 지난 역산 watcher야: 여권 신청", reasonCode = `reverse_plan_due`
- `server/src/services/watcher-daily-push.ts`: 동일 패턴. `WatcherPushItem.nextStepLabel` 추가. 다이제스트 라인에 `→ 여권 신청` suffix 포함
- Tests: integration test에서 Today bubble message/reasonCodes, push digest nextStepLabel/message 검증

RESOLVED: ISSUE-3 — POST 응답 `{ watcher, tasks, targetTask, links, reversePlan }` 반환
- `server/src/repositories/watchers.ts`: `CreateReversePlanResult` 타입을 `{ watcher, tasks: TaskSummary[], targetTask: TaskSummary, links: LinkSummary[], reversePlan: ReversePlanView }`로 변경. `.returning()` 호출에서 full row 캡처. `reversePlan`은 `ReversePlanView`(모두 "todo" 상태)로 직접 구성
- Tests: integration test POST 응답 검증 업데이트

RESOLVED: ISSUE-4 — rollback 및 snooze 검증 추가
- Rollback: SQLite BEFORE INSERT TRIGGER로 링크 삽입 강제 실패 → watcher/task 행 없음 확인
- Snooze: snoozedUntil 미래 설정 후 `/api/today` bubble 0개, `selectDueForPush` items 0개 확인
- 추가 tests: rollback(1), Today snooze(1), push snooze(1) = 총 3개 추가

자동 체크: typecheck ✅ / shared tests 157 PASS ✅ / server unit 225 PASS ✅ / web unit 282 PASS ✅ / integration 431 PASS ✅
