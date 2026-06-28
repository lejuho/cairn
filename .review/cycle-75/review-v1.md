# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Missing contract tests for needs_review and schedule_prompt location context
- Location: web/src/Today.test.tsx:3679
- Analysis: The Cycle 75 frontend test block covers `next_event` location rendering, uncached/unresolved states, missing-location quiet behavior, and both conflict pair locations. It does not cover location context on `needs_review` cards or `schedule_prompt` cards. The route integration block at `server/src/routes/today.integration.test.ts:817` also seeds ordinary day events only, so it proves day-event/next-event context but not the `needsReviewEvents` or `unscheduledEvents` paths that feed `needs_review` and `schedule_prompt`.
- Impact: The Sprint Contract explicitly requires tests for `next_event`, `needs_review`, `schedule_prompt`, conflict card location context, and preservation of existing card actions. It also requires existing `needs_review` reply/detail behavior and `schedule_prompt` slot/dismiss behavior to remain covered while location context is present. Those portions are not verified, so the contract is incomplete even though the current implementation appears to render the chip in those branches.
- Fix direction: Add frontend tests that render a `needs_review` card with a matching `locationContexts` entry and assert the location chip plus existing detail/reply behavior still work. Add frontend tests that render a `schedule_prompt` card with a matching context and assert the chip plus slot/dismiss controls still work. Add route integration coverage for a needs-review event and an unscheduled event with seeded `geocode_cache` rows so `locationContexts` is proven for all event-bearing Today input sets.

## Sprint Contract Check
- `GET /api/today` includes `locationContexts`: PASS. The route builds cache-backed contexts and `buildTodaySurface` returns them.
- Card discriminants/order/priority unchanged: PASS by diff; card construction order is unchanged.
- Cache-only Today context: PASS by diff/static review. Today reads `geocode_cache`; no provider call or Today geocode POST path was added.
- Missing/uncached/resolved/ambiguous/zero-result/failed shaping: PASS for shared schema and pure builder tests.
- Conflict cards show both locations without changing opener: PASS in frontend tests.
- `next_event`, `needs_review`, and `schedule_prompt` action preservation: BLOCKED. `next_event` and conflict opener are covered; `needs_review` and `schedule_prompt` are not covered with location context present.
- External map URL safety: PASS by diff/tests for coordinate/authored-text links; no API key/provider payload is exposed.
- No migration/travel-time/autocomplete/cron/bulk scope: PASS by diff/static review.
- Semantic-token styles and 44px map action: PASS by CSS review.
- `docs/codebase-map.md` update: PASS.

## Automatic Checks
- `corepack pnpm lint`: PASS
- `corepack pnpm typecheck`: PASS
- `corepack pnpm test`: PASS
- `corepack pnpm test:integration`: PASS
- `corepack pnpm build`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check master...HEAD`: PASS
- Static negative checks:
  - No migration/schema/provider gateway implementation changes: PASS
  - Today provider/geocode call boundary: PASS; existing Cycle 74 event-detail geocode path remains unchanged
  - No travel-time/future-cycle implementation scope: PASS

## Changes Outside Plan
None found in the committed Cycle 75 diff. The worktree still contains unrelated uncommitted dotfile/config changes outside this review scope.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED (Executor response, append at file end)
