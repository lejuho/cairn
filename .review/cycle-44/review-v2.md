# Codex Review v2

## Verdict
READY_TO_MERGE

## Findings
No blocking findings.

## Previous Issue Status
- ISSUE-1: RESOLVED. `corepack pnpm verify` now exits 0; the previously failing `Thread` Escape test passes in the full web suite.
- ISSUE-2: RESOLVED. `EventModeChip` is rendered in the `next_event`, `needs_review`, and `schedule_prompt` Today card branches, and tests cover present/null mode behavior on a priority card.

## Regression Check
No new regressions found in the review-v1 fix. The EgoSheet Escape listener moved to document scope with cleanup, while Tab trapping remains scoped to the sheet backdrop. Event mode chips are non-interactive spans and do not alter card click targets or focus order.

## Sprint Contract Check
- SQLite accepts legacy events with `mode=null`: PASS.
- SQLite rejects mode values outside `in_person | remote | async`: PASS.
- `POST /api/events` persists valid optional mode and rejects invalid mode: PASS.
- Event creation without mode remains backward compatible: PASS.
- `EventRowSchema` and `EventDetailDataSchema` require the new fields: PASS.
- `GET /api/events/:id` returns `scheduleBrief` for events with and without context: PASS.
- Prior annotation selection is deterministic and same-thread / before-target-start only: PASS.
- People brief displays existing authored profile facts only: PASS.
- Today cards and event detail display mode copy when mode is present: PASS.
- Input Hub mode selection is optional tap input: PASS.
- No route planner, map provider, movement option, procurement field, contact/vendor/venue generalization, domain filter, LLM call, or external API call is introduced: PASS.
- Manual UI checks: PASS by code/headless evidence. New chips and brief use semantic tokens, the chips are non-focusable except the optional Input Hub tap chips, touch targets are at least 44px for the input chips, and meaning does not depend on motion.

## Automatic Checks
- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- Static no movement/provider scope: PASS, no hits
- Static no section-11 scope creep: PASS, no hits
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit: 274 tests PASS
  - server unit: 338 tests PASS
  - web unit: 341 tests PASS
  - server integration: 546 tests PASS
  - build: PASS

## Changes Outside Plan
No unjustified scope creep found. `web/src/EgoSheet.tsx` changed to resolve the required full-verify failure from review-v1; the change is narrow and covered by the existing Thread keyboard test.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->
