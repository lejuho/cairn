# Codex Review v2

## Verdict
READY_TO_MERGE

## Findings
None.

## Previous Issue Status
- ISSUE-1: RESOLVED
  - `ApprovePromotionRequestSchema` now accepts optional `threadId`.
  - Thread approval sends `threadId: id`, matching the scoped suggestion fetch.
  - The approval route recomputes suggestions with `findCandidateSources(db, approveThreadId)`.
  - Integration coverage now proves scoped approve succeeds with same-name mentions in another thread, while the intentionally unscoped approval path returns `PROMOTION_STALE`.

## Regression Check
No regression found. Global approval remains supported for non-thread-scoped callers, and missing/omitted `threadId` falls back to global stale checking. POST `threadId` is advisory scope only; occurrence target existence is still validated before mutation.

Manual browser execution was not run in this headless review environment. Source/test evidence covers the manual constraints: the panel uses existing `today-card` and `today-submit-btn` styling, the approve button is a native keyboard-triggerable `<button>`, `today-submit-btn` has the established 44px touch target styling, the screen keeps reduced-motion handling from the shared Thread/resource styles, and Vitest covers panel render, approve refresh, and scoped error behavior.

## Sprint Contract Check
- Suggestions are read-only and deterministic: PASS.
- Candidate appears only for same normalized name+kind on at least two distinct target nodes: PASS.
- Candidate detection covers event, task, and thread: PASS.
- Scoped `threadId` suggestion approval: PASS.
- Approval requires explicit user action and is transactional: PASS.
- Approval creates/reuses one resource and idempotently links every occurrence: PASS.
- Duplicate/full-link suppression avoids repeated nagging and duplicate links: PASS.
- Existing `resource_links` firmness/reason are not overwritten by duplicate approval: PASS.
- No LLM/Gmail/GCal/Telegram/web-crawler/external fetch dependency in backend suggestion detection: PASS.
- No full graph or ego-graph UI introduced: PASS.
- Thread screen remains usable on suggestion fetch or approval failure: PASS.
- `docs/codebase-map.md` updated: PASS.

## Automatic Checks
- `git diff --check master..HEAD`: PASS
- static dependency search for LLM/external API/fetch in resource backend boundary: PASS
- `corepack pnpm db:generate`: PASS
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 211 PASS
  - server unit tests: 278 PASS
  - web unit tests: 312 PASS
  - server SQLite integration tests: 499 PASS
  - production build/PWA generation: PASS

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->
