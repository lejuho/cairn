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
