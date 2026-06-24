# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Literal scope-creep check fails on checked source
- 위치: shared/src/eventDetail.ts:49
- 분석: Sprint Contract's static no section-11 scope-creep command returns a hit because the checked source file contains `procurement` in a comment. This appears to be a false positive, not actual procurement functionality, but the exact automatic check required by the plan does not pass.
- 영향: Automatic Checks are not all PASS, so the cycle cannot meet the merge criteria.
- 수정 방향: Reword the comment in checked files so the exact static command has no hits, or amend the plan through the escalation path if the command is intended to allow comments.

### ISSUE-2 [MEDIUM] Read-only integration test omits `params`
- 위치: server/src/routes/events.integration.test.ts:447
- 분석: The test name says resource/resource_links/people/params row counts, but `counts()` checks only `resources`, `resource_links`, and `people`. The plan requires GET detail to leave events, annotations, resources, resource_links, people, and params unchanged.
- 영향: Sprint Contract's read-only guarantee is not fully verified against SQLite for `params` in the preparation path.
- 수정 방향: Include `params` in the row-count assertion. Prefer one GET detail read-only assertion that covers all six required tables, or add `params` to the existing preparation read-only assertion while relying on the earlier events/annotations test explicitly.

### ISSUE-3 [LOW] Manual UI checks are not recorded
- 위치: .review/cycle-45/plan.md:142
- 분석: The plan requires Mobile Chrome light/dark readability, keyboard non-focusability, and reduced-motion verification for the new preparation rows. I found automated UI tests for rendering/hiding the section, but no recorded manual evidence.
- 영향: Manual portion of the Sprint Contract remains open before READY_TO_MERGE.
- 수정 방향: Record the manual check result in RESOLVED or another cycle artifact, or obtain explicit user approval for the unautomated UI checks before merge.

## Sprint Contract Check
- `EventDetailDataSchema` requires `scheduleBrief.preparations`: PASS.
- Empty preparations are valid and no linked resources return `[]`: PASS.
- Direct, thread, and previous-event scopes are wired and tested: PASS.
- Dedup/grouping and deterministic sort: PASS in pure service tests.
- Source person known/null handling: PASS in service tests and route integration for known person.
- Event detail UI renders preparation rows and hides empty section: PASS in Testing Library tests.
- Read path does not mutate required tables: BLOCKED, `params` is not covered by the integration assertion.
- No AI/manual/procurement/movement/external scope: code inspection PASS, literal static command BLOCKED by comment false positive.
- Manual mobile/light/dark/keyboard/reduced-motion checks: NOT RUN / not recorded.

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm verify`: PASS
  - shared unit: 277 passed
  - server unit: 348 passed
  - web unit: 344 passed
  - server integration: 553 passed
  - build: PASS
- `git diff --check master..HEAD`: PASS
- Static no write/external in new preparation diff: PASS (no matches; `rg` exited 1)
- Static no section-11 scope creep: FAIL
  - `shared/src/eventDetail.ts:49:// procurement/movement fields.`

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-1 — static scope-creep command now passes
- `shared/src/eventDetail.ts:46-49`: the explanatory comment contained the literal word `procurement`, which the plan's exact `rg` command flags even inside a comment. Reworded to "no AI suggestion, no manual entry, no purchasing or transport fields" (no banned token). The command `rg -n "procurement|proc_|vendor|venue|domain|travelOption|routeOption|manualPreparation|aiSuggestion|star_|resume" shared/src/eventDetail.ts server/src/routes/events.ts server/src/repositories/resources.ts web/src/Today.tsx` now returns **zero hits**. No behavior change.

RESOLVED: ISSUE-2 — read-only assertion now covers all six tables incl. `params`
- `server/src/routes/events.integration.test.ts`: the preparation read-only test's `counts()` now includes `events`, `annotations`, `resources`, `resource_links`, `people`, **and `params`**; a `params` row is seeded before the GET so its count is meaningfully asserted unchanged. Test renamed accordingly. Confirmed the preparation read path touches only resources/resource_links/people — never params. 30 events integration tests pass.

RESOLVED: ISSUE-3 — manual UI checks recorded (headless code/test evidence)
- Physical mobile Chrome is unavailable in this environment; per plan §검증 방식 가이드 ("manual mobile/light/dark/reduced-motion evidence may be recorded in review if physical checks are unavailable"), evidence is recorded here:
  - **Light/dark readability**: the preparation rows use semantic tokens only (`card-meta`, `resource-firmness--{hard|soft|tentative}`, and `.event-brief-prep*` which reference no hardcoded colors). Light/dark is inherited from the existing token system, identical to the surrounding brief rows already shipped in cycle-44.
  - **Keyboard**: the "준비" subsection adds **no focusable controls** — it renders only `<p>`/`<ul>`/`<li>`/`<span>` (no `<button>`/`<a>`/`<input>`). Today's event-detail sheet focus order is therefore unchanged. (The sheet's existing focus/close tests remain green.)
  - **Reduced motion**: the preparation rows carry no animation/transition; meaning is text-only, so reduced-motion preference does not affect comprehension.
  - **Automated coverage**: Vitest covers render (item/knowledge labels, source person, firmness chip, reason), hide-when-empty, and prep-only brief rendering.

자동 체크: lint ✅ / typecheck ✅ / test ✅ (shared 277 / server 348 / web 344) / test:integration ✅ (events 30) / build ✅ / `corepack pnpm verify` EXIT=0 / `git diff --check master..HEAD` clean / db:generate no changes / static scope-creep command **0 hits** / static no-write-external **0 hits**
