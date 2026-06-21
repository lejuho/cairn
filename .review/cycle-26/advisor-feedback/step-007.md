# Step 007 — review-v1 resolution completion check

Cycle: 26
Pass: 4
Files Changed: web/src/Thread.tsx, .review/cycle-26/review-v1.md

## Advisor Verdict
PASS

## Advisor Feedback
Completion check — all three regression concerns verified, no regressions.

Concern 1 (drop hex fallback): SAFE. Both `--moved` and `--border` are defined
in `:root` (dark) and in the `prefers-color-scheme: light` block of styles.css.
The variables always resolve; the hardcoded hex fallback was unreachable except
in a malformed/theme-mismatched state and could only produce a light-biased
color that breaks dark mode. Dropping it is correct.

Concern 2 (`--moved` semantic fit): acceptable, no scope creep. Codex's own
ISSUE-1 fix direction explicitly names `var(--moved)` for non-blocking warnings.
`--moved` is the amber/gold attention-outcome token already used for
attention-style emphasis (today-card--watcher, cost-chip--social). Its hue is
visually close to the original `#b45309`. Introducing a new `--warn` token would
expand the design-system surface beyond the ask — correctly avoided.

Concern 3 (RESOLVED format): compliant. Boundary sentinel present and untouched;
all RESOLVED content below it; Codex body unmodified (append-only respected);
structure present (Issue Classification → Applied → 자동 체크); ISSUE-2's
APPLY-as-documented justified per Codex's explicit allowance.

Minor note: RESOLVED prose cites Thread.tsx:468/:498 while hunks land at 467/497
(off-by-one in annotation only; code is correct; 21/21 tests pass).

## Sonnet Response
- 적용: All concerns confirmed. ISSUE-1 token substitution kept with hex
  fallbacks dropped (tokens defined in both themes). ISSUE-2 documented with
  automated + code evidence. RESOLVED appended below sentinel.
- 무시: none.
