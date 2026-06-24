# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Literal scope-creep check fails on checked diff
- 위치: shared/src/resources.ts:55, shared/src/resources.test.ts:303
- 분석: The Sprint Contract's exact static no-scope-creep command returns hits for `procurement` in a source comment and `aiSuggestion` in a shared unit test. These look like false positives rather than implemented out-of-scope behavior, but the plan requires the literal command to pass.
- 영향: Automatic Checks are not all PASS, so the cycle cannot meet merge criteria.
- 수정 방향: Reword checked comments/tests to avoid the banned tokens while preserving strict-schema coverage, or change the static command only through the proper plan/escalation path.

### ISSUE-2 [LOW] Manual UI checks are not recorded
- 위치: .review/cycle-46/plan.md:135
- 분석: The plan requires Mobile Chrome light/dark readability, keyboard order, and reduced-motion verification. I found automated UI coverage for the add flow, but no recorded manual evidence for these checks.
- 영향: Manual portion of the Sprint Contract remains open before READY_TO_MERGE.
- 수정 방향: Record manual evidence in RESOLVED or another cycle artifact. If physical mobile Chrome is unavailable, record code/test evidence explicitly as allowed by the plan's Review Guidance.

## Sprint Contract Check
- Shared request schema trims and rejects blank/overlong/injected fields: PASS.
- Response schema accepts `{ resource, link, reusedResource, reusedLink }`: PASS.
- `POST /api/events/:id/preparations` creates item resource + direct event link: PASS.
- Existing item resource reuse: PASS.
- Repeat POST idempotency and `reusedLink=true`: PASS.
- Existing link firmness/reason not rewritten: PASS.
- Missing event and invalid body no-write behavior: PASS.
- GET detail after POST includes `event_direct` preparation: PASS.
- UI collapsed add control, one-line submit, success refetch/render, failure error/text retention: PASS.
- Empty prep state remains quiet except explicit add affordance: PASS.
- No actual AI/procurement/rental/contact/domain/movement/external implementation found: PASS by inspection, but literal static command FAIL.

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm verify`: PASS
  - shared unit: 286 passed
  - server unit: 348 passed
  - web unit: 347 passed
  - server integration: 562 passed
  - build: PASS
- `git diff --check master..HEAD`: PASS
- Static no external/LLM/map in implementation diff: PASS (no matches; `rg` exited 1)
- Static no out-of-scope section-11 fields in implementation diff: FAIL
  - `shared/src/resources.test.ts:303` contains `aiSuggestion`
  - `shared/src/resources.ts:55` contains `procurement`

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY

### Applied

RESOLVED: ISSUE-1 — static no-scope-creep command now passes on the diff
- The plan's exact command flagged two false positives that were the cycle's OWN strict-rejection coverage / descriptive comment, not out-of-scope code:
  - `shared/src/resources.ts`: the comment listing rejected fields contained the literal `procurement`. Reworded to "only `name` is accepted — no kind/sourcePerson/note/link or other injected fields" (no banned token). Schema unchanged (`z.object({name: trim 1..120}).strict()`).
  - `shared/src/resources.test.ts`: the strict-rejection test used an injected key `aiSuggestion` (a banned token) and named the test after it. Changed the injected key to `suggested` and the test name to "...extra fields"; `.strict()` still rejects the unknown key, so injected-field coverage is fully preserved.
- After committing the reword, `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "procurement|proc_|vendor|venue|domain|travelOption|routeOption|manualKnowledge|aiSuggestion|rental"` returns **no hits**. (Pre-existing tokens in `watchers.test.ts`/`eventDetail.test.ts` are already in master, so they never appear in the master..HEAD diff.)

RESOLVED: ISSUE-2 — manual UI checks recorded (headless code/test evidence)
- Physical mobile Chrome is unavailable; per plan §검증 방식 가이드 ("manual mobile/light/dark/reduced-motion evidence may be recorded in review if physical checks are unavailable"), evidence is recorded here:
  - **Light/dark readability**: the manual "준비물 추가" affordance uses semantic-token classes only (`action-btn action-btn--sm`, `today-reply-input`, `today-submit-btn`, `sheet-error`, `.event-prep*`) with no hardcoded colors; light/dark is inherited from the existing token system, identical to the note-submit form already shipped.
  - **Keyboard**: the collapsed toggle → expanded input → submit → existing 닫기 button form a natural DOM-order tab sequence inside the bottom sheet; no custom `tabindex` and no change to the sheet's focus handling. Submit is disabled for blank input.
  - **Reduced motion**: success (collapse + new `prep-row`) and failure (`role="alert"` text, retained input text) are conveyed by text/DOM, not animation; no motion is required to understand outcome.
  - **Automated coverage**: Vitest covers collapsed-toggle + disabled-submit, submit→POST→clear+refetch+render, and failure-keeps-typed-text.

자동 체크: lint ✅ / typecheck ✅ / test ✅ (shared 286 / server 348 / web 347) / test:integration ✅ (events 39) / build ✅ / `corepack pnpm verify` EXIT=0 / `git diff --check master..HEAD` clean / db:generate no changes / static no-external **0 hits** / static no-scope-creep **0 hits** (post-commit diff)
