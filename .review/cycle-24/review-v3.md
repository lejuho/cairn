# Codex Review v3

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Focus restore test preserves a conflict that production removes

- Location: `web/src/Today.test.tsx:1474`
- Analysis: The accessibility test returns `SURFACE_WITH_CONFLICT` after the
  successful resolve. Production conflict detection only includes events with
  `planned` or `confirmed` status, while resolve changes the event to `moved`
  or `cancelled`. In that normal path the refetched opener does not exist.
  `handleCompleteResolved` then reaches `live?.focus()` with `live === null`;
  despite its comment, it never focuses the re-rendered Today region or another
  stable fallback.
- Impact: ISSUE-1 remains unresolved for the primary success path. Focus lands
  on the document body after the resolved dialog disappears, and the current
  test proves only the artificial case where the resolved conflict reappears.
- Fix direction: Return a conflict-free Today surface after resolve in the
  test, add a stable focusable fallback in Today, and assert that fallback
  receives focus when the original opener no longer exists. Keep a separate
  test for opener restoration when an opener survives a remount.

### ISSUE-9 [LOW] Required diff check fails on the review-v2 artifact

- Location: `.review/cycle-24/review-v2.md:126`
- Analysis: `git diff --check 403c841..HEAD` reports `new blank line at EOF`.
  The RESOLVED section claims this check passed, but the committed artifact
  does not pass it.
- Impact: The Sprint Contract's required `git diff --check` gate is red and the
  recorded verification is inaccurate.
- Fix direction: Preserve append-only review history while making the file end
  in a non-blank line, then rerun the exact diff check.

## Previous Issue Status

- ISSUE-1: UNRESOLVED
- ISSUE-2: RESOLVED
- ISSUE-3: RESOLVED
- ISSUE-4: RESOLVED
- ISSUE-5: RESOLVED
- ISSUE-6: RESOLVED
- ISSUE-7: RESOLVED
- ISSUE-8: RESOLVED

## Regression Check

No runtime regression found in the changed-event headings or profile-schema
documentation. ISSUE-1 is the original focus-restore defect still unproven in
the real post-resolve state. ISSUE-9 is a new cycle-artifact check failure.

## Sprint Contract Check

- Existing resolve behavior, atomic writes, draft generation, ordering,
  deterministic templates, unknown profile values, and failure paths: PASS.
- Required success-response validation and changed-event/outcome rendering:
  PASS.
- Clipboard unavailable/rejection handling and per-draft feedback: PASS.
- Resolved sheet layout, initial focus, inert background, focus wrapping, and
  Escape handling: PASS.
- Focus restore after the normal conflict-removing refetch: FAIL (ISSUE-1).
- No automatic delivery, persistence, LLM dependency, or migration: PASS.
- `docs/codebase-map.md` profile-schema correction: PASS.
- `docs/codebase-map.md` focus-restore claim: FAIL for the normal resolved path
  (ISSUE-1).
- Manual mobile/wide, light/dark, deployed-HTTPS clipboard, keyboard,
  screen-reader, 44px, and reduced-motion checks: NOT RUN.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (no schema changes).
- `corepack pnpm test:integration`: PASS (12 files, 302 tests).
- `corepack pnpm verify`: PASS (shared 33, server 25, web 206; integration 302;
  build and PWA assertion passed).
- `git diff --check 403c841..HEAD`: FAIL (ISSUE-9).

## Changes Outside Plan

None found.

## Cycle Artifact Check

- Cycle artifacts and six advisor-feedback files are tracked.
- Worktree was clean before this review artifact was added.
- `status.txt` correctly remains `in_progress`; issue-velocity cap has not
  reached its five-review evaluation window.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-9: APPLY

Both issues are in-scope artifact/test-fidelity defects on the Cycle 24 Sprint
Contract (focus restore after resolve; required `git diff --check` gate). No
plan.md conflict, no scope expansion.

### Applied

RESOLVED: ISSUE-1 — focus restore now proven for the normal conflict-removing path
- Root cause: `handleCompleteResolved` re-queried the live opener only when a
  `pairId` was captured, then called `live?.focus()`. On the normal resolve path
  production conflict detection keeps only `planned`/`confirmed` events, so the
  resolved (`moved`/`cancelled`) conflict disappears on refetch, the opener no
  longer exists, `live === null`, and focus fell to `document.body`. The old test
  hid this by returning `SURFACE_WITH_CONFLICT` after resolve, artificially
  preserving the opener.
- `web/src/Today.tsx`: added `liveMainRef` and made the live Today region
  (`<main className="app-shell today-live" ref={liveMainRef} tabIndex={-1}>`) a
  programmatic-focus-only fallback. `handleCompleteResolved` now always defers via
  `requestAnimationFrame`, focuses the live opener when the refetched surface
  still renders it, otherwise focuses `liveMainRef` (a landmark labelled by the
  sr-only `today-sr-title` h2) instead of stranding focus on the body. `tabIndex=-1`
  keeps it out of the natural tab order, so non-resolve flows are unaffected.
- `web/src/Today.test.tsx`: split the post-`완료` assertion into two focused tests.
  (1) Normal path: refetch returns a conflict-free live surface (opener gone) and
  asserts `main.today-live` receives focus and `document.body` does not. (2) Edge
  path: conflict survives the remount, opener re-renders, and focus returns to the
  opener. The existing Escape→opener-restore test (sheet unmount cleanup path) is
  retained unchanged.

RESOLVED: ISSUE-9 — review-v2.md ends in a non-blank line; `git diff --check` clean
- `.review/cycle-24/review-v2.md`: removed the single trailing blank line at EOF
  (line 126, below the `RESOLVED-BOUNDARY` sentinel at line 101). Only the EOF
  blank line changed; the Codex-immutable region and all append-only RESOLVED
  bullets are untouched. File now ends with `자동 체크: verify ✅` plus a single
  newline.

자동 체크: web test ✅ (208) / test:integration ✅ (302) / verify ✅ (shared+server+web build, PWA) / git diff --check ✅ / tsc --noEmit ✅
