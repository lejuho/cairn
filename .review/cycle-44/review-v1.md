# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] `pnpm verify` fails in web unit tests
- 위치: web/src/Thread.test.tsx:633
- 분석: `corepack pnpm verify` fails during `web test`. The failing case is `Thread — resource-focus section > Escape closes the ego sheet (ISSUE-2 keyboard)`: after firing Escape on the ego sheet parent, `ego-sheet` remains in the document.
- 영향: Sprint Contract requires `corepack pnpm verify` PASS before merge. Because the command exits `1`, the automatic-check gate is not met. Even if this is unrelated or flaky, the cycle cannot be marked ready while the full verify command is red.
- 수정 방향: Restore this test to green or prove and fix the flaky event target path. Re-run `corepack pnpm verify` after the fix.

### ISSUE-2 [MEDIUM] Today priority cards do not show event mode
- 위치: web/src/Today.tsx:1466
- 분석: Mode copy is rendered in the event detail sheet (`event-mode-chip`) and timeline rows (`tl-mode-chip`), but the `next_event`, `needs_review`, and `schedule_prompt` card branches do not render mode when `card.event.mode` is present.
- 영향: Sprint Contract says "Today cards and event detail display mode copy when mode is present." The event detail part is covered, but the Today priority cards are not.
- 수정 방향: Add a small shared event-mode chip render helper and use it in event-bearing Today card branches (`next_event`, `needs_review`, `schedule_prompt`) without changing card priority or actions. Add tests proving mode copy appears on at least one Today priority card and remains absent for null mode.

## Sprint Contract Check
- SQLite accepts legacy events with `mode=null`: PASS.
- SQLite rejects mode values outside `in_person | remote | async`: PASS.
- `POST /api/events` persists valid optional mode and rejects invalid mode: PASS.
- Event creation without mode remains backward compatible: PASS.
- `EventRowSchema` and `EventDetailDataSchema` require the new fields: PASS.
- `GET /api/events/:id` returns `scheduleBrief` for events with and without context: PASS.
- Prior annotation selection is deterministic and same-thread / before-target-start only: PASS by repository/service inspection and tests.
- People brief displays authored profile facts only: PASS.
- Today cards and event detail display mode copy when mode is present: BLOCKED by ISSUE-2.
- Input Hub mode selection is optional tap input: PASS.
- No route planner, map provider, movement option, procurement field, contact/vendor/venue generalization, domain filter, LLM call, or external API call: PASS by static search.

## Automatic Checks
- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- Static no movement/provider scope: PASS, no hits
- Static no section-11 scope creep: PASS, no hits
- `corepack pnpm verify`: FAIL
  - lint: PASS
  - typecheck: PASS
  - shared unit: 274 tests PASS
  - server unit: still running successfully until web failure; no server failure observed before command exit
  - web unit: FAIL, 1 failed / 338 passed
  - integration/build: NOT RUN because verify stopped at web unit failure

## Changes Outside Plan
No scope-creep implementation found. The failing Thread test is outside the feature surface, but it is still part of the required verify gate.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY

### Applied

RESOLVED: ISSUE-1 — verify green; ego sheet Escape made robust against parallel-run flakiness
- `web/src/EgoSheet.tsx`: the keydown handler was scoped to the backdrop element, so under parallel vitest execution the Escape event could miss its target. Split the handling — **Escape now binds at the `document` level** (fires regardless of which element holds focus and bubbles reliably), while the **Tab focus-trap stays scoped to the backdrop**. Both listeners are removed on unmount; focus still returns to the opener.
- Verified: Thread 39 ✅, full web suite 341 ✅, ran the full web suite 3× with zero failures. `corepack pnpm verify` EXIT=0.

RESOLVED: ISSUE-2 — Today priority cards now show event mode
- `web/src/Today.tsx`: added a shared `EventModeChip` helper (renders nothing when mode is null; non-interactive `<span>`, no change to card priority/actions/focus order) and placed it in the `next_event`, `needs_review`, and `schedule_prompt` card branches. Timeline rows and the event detail sheet already carried mode (cycle-44).
- `web/src/Today.test.tsx`: +2 tests — next_event priority card shows chip "대면" (`data-mode="in_person"`) when mode set, and no chip when mode null.

자동 체크: lint ✅ / typecheck ✅ / test ✅ (shared 274 / server 338 / web 341) / test:integration ✅ / build ✅ / `corepack pnpm verify` EXIT=0 / `git diff --check master..HEAD` clean / db:generate no changes
