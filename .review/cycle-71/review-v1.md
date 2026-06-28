# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Today record targets omit event-bearing cards
- Location: web/src/Today.tsx:897
- Analysis: Today builds record-mode targets only from `view.surface.dayEvents`. The plan requires Today record targets to include scheduled day events and event-bearing cards available in the current surface. The Today surface schema has event-bearing cards outside `dayEvents`, including `conflict` pairs, `next_event`, `needs_review`, and `schedule_prompt`.
- Impact: A live Today surface can show an event-bearing card whose event is not selectable in `기록` mode. This fails the Cycle 71 input spec for record target enumeration and leaves a coverage gap because Today record tests seed only `dayEvents`.
- Fix direction: Build Today record targets from `surface.dayEvents` plus event payloads extracted from event-bearing cards (`conflict` both events, `next_event`, `needs_review`, `schedule_prompt`), then dedupe. Add a Today test where `dayEvents` is empty but an event-bearing card is present and record submit posts to `/api/events/:id/annotations`.

### ISSUE-2 [LOW] Watcher success card does not indicate created watcher kind
- Location: web/src/InputHub.tsx:403; web/src/Today.tsx:1044
- Analysis: The watcher result state stores only the label, and both pages render the static status `지켜볼 것이 만들어졌어`. The plan's normal output requires the Watcher result card status to indicate which watcher kind was created.
- Impact: Success feedback does not confirm whether the explicit subtype produced a date-threshold, reverse-plan, or manual-exogenous watcher.
- Fix direction: Store the selected watcher subtype or subtype label in the watcher result and render subtype-specific status text in both `/input` and Today. Add or extend tests to assert subtype/kind feedback.

## Sprint Contract Check
- `/input` and Today Composer each expose exactly five modes (`일정`, `스레드`, `할 일`, `Watcher`, `기록`): PASS.
- Existing `일정`, `스레드`, and `할 일` behavior from Cycles 69-70 remains unchanged: PASS by focused inspection and preserved tests.
- `Watcher` mode has explicit subtype selection for `날짜 기반`, `역산 계획`, and `수동 확인`: PASS.
- `Watcher` mode routes each subtype to the existing endpoints with the expected request shapes: PASS.
- `Watcher` mode success renders a `Watcher` `ResultCard` linking to `/watch`: PASS, but subtype/kind status text is incomplete (ISSUE-2).
- `기록` mode requires an explicit event target and posts only to `/api/events/:id/annotations` with `{ text }`: PARTIAL. Posting and explicit selection pass, but Today target enumeration is incomplete (ISSUE-1).
- `기록` mode success renders a `기록` `ResultCard` with event-linked visibility copy and parsed/raw status: PASS.
- Empty text, missing watcher subtype fields, and missing record event target cannot submit through the UI: PASS.
- API failures preserve typed text, selected mode, watcher subtype fields, and record target: PASS.
- Shared `CreationComposer` remains presentational-only: PASS. Static purity check found no fetch/apiJson/API/result/navigation code.
- Today top-level loading, quiet, live, error, and access-session states remain available: PASS.
- Existing Today card priority, event detail, conflict resolution, notification draft sheet, slot candidate preview/apply/dismiss, watcher cards, feasibility controls, preparation suggestions, manual intake sheet, and domain filter remain available: PASS by focused inspection, preserved tests, and static priority check.
- Existing `/input` advanced event/task forms, unscheduled list, slot scheduling, and people controls remain available: PASS.
- Existing `/watch` create bottom sheet and watcher card behaviors remain available: PASS by preserved Watchers tests.
- New CSS uses semantic tokens only and all new controls are 44px+: PASS.
- No backend route, shared API contract, DB schema, migration, LLM prompt, automatic watcher-B crawling, n8n pipeline, standalone diary storage, or Mirror rewrite is introduced: PASS.

## Automatic Checks
- `corepack pnpm lint`: PASS
- `corepack pnpm typecheck`: PASS
- `corepack pnpm test`: PASS (shared 424, server 470, web 484)
- `corepack pnpm test:integration`: PASS (server 686)
- `corepack pnpm build`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check master...HEAD`: PASS
- No backend/shared/DB changes: PASS. Static negative check returned no matches.
- No new external/LLM/schema/diary scope: PASS. Static negative check returned no implementation matches.
- Shared Composer purity: PASS. Static check returned no matches.
- Today card priority stays unchanged: PASS. Static priority check returned no semantic reordering matches.

## Changes Outside Plan
None in committed implementation scope.

## Review Notes
- I used a clean-context subagent to independently verify the Today record-target enumeration risk after Andon blocked repeated broad output of known signatures.
- The status file remains `in_progress`; this cycle is not ready to merge until the findings are resolved and re-reviewed.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY (plan Input/Output Spec requires Today record targets = scheduled day events AND event-bearing cards in the current surface; the gap is real.)
- ISSUE-2: APPLY (plan Normal output requires the Watcher result card status to indicate which watcher kind was created.)

### Applied

RESOLVED: ISSUE-1 — Today 기록 targets now include event-bearing cards, not just `dayEvents`.
- `web/src/Today.tsx`: `recordTargets` = `dedupeTargets([...surface.dayEvents, ...cardEvents])` where `cardEvents` extracts events from `surface.cards` — `conflict`→`pair.a`+`pair.b`, `next_event`/`needs_review`/`schedule_prompt`→`event` (watcher/two_minute_task/task_schedule_prompt carry no event, excluded). Deduped by event id. Derived in a separate value (not in the card render), so Today card priority/order is unchanged.
- `web/src/Today.test.tsx`: new test — `dayEvents: []` but a `next_event` card present → its event (id 91) is selectable in 기록 mode and submit posts `/api/events/91/annotations` `{ text }`.
- `/input` was already correct (record targets merged `dayEvents` + `unscheduledEvents` in `loadData`), so this was a Today-only gap; no `/input` change.

RESOLVED: ISSUE-2 — Watcher result card now states the created watcher kind.
- `web/src/composerModes.tsx`: added `watcherSubtypeLabel(subtype)` → 날짜 기반 / 역산 계획 / 수동 확인 (from `WATCHER_SUBTYPES`).
- `web/src/InputHub.tsx` + `web/src/Today.tsx`: `ComposerResult` watcher variant gains `subtype: WatcherSubtype` (stored from the selected `watcherSubtype` at submit); the Watcher `ResultCard` status is now `${watcherSubtypeLabel(subtype)} Watcher가 만들어졌어` on both pages. Endpoints/request shapes unchanged.
- Tests: the three InputHub subtype tests assert the result card status contains its subtype label (날짜 기반 / 역산 계획 / 수동 확인); the Today date-threshold test asserts "날짜 기반".

Scope: frontend-only, within plan. `CreationComposer` untouched (still presentational/pure). No backend/shared/route/DB/LLM change; no card-priority change.

자동 체크: `corepack pnpm lint` ✅ / `typecheck` ✅ / `test` web 485 (InputHub 63 / Today 170) ✅ / `build` ✅ / `git diff --check master...HEAD` ✅ / CreationComposer purity grep ∅ / Today card-priority diff ∅. Committed in pass-002.
