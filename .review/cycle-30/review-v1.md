# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Active snooze can be ignored when RFC3339 offsets differ

- Location: `server/src/services/watchers.ts:67`
- Analysis: `evaluateWatcherA` checks active snooze with a lexicographic string comparison: `row.snoozedUntil > now`. Both values are RFC3339 datetimes with offsets, so string order is not time order when one value uses `Z` and another uses `+09:00` or another offset. Concrete counterexample: `snoozedUntil="2026-06-22T00:30:00.000Z"` is 30 minutes after `now="2026-06-22T09:00:00+09:00"`, but string comparison returns false while epoch comparison returns true. The watcher would surface even though the snooze is still active.
- Impact: Violates Sprint Contract items: future `snoozed_until` hides a watcher; Today snooze success refreshes and removes the card.
- Fix direction: Parse both values with `Date.parse` and compare epoch milliseconds. Treat invalid persisted `snoozedUntil` fail-open in a documented way, preferably as expired/not active so malformed DB data does not hide due watchers. Add a unit test and an integration test with mixed offsets.

### ISSUE-2 [LOW] Cycle status file uses an invalid state

- Location: `.review/cycle-30/status.txt:1`
- Analysis: The file contains `ready_to_review`, but AGENTS allows only `in_progress`, `ready_to_merge`, or `escalated`.
- Impact: Violates cycle status contract and blocks merge readiness even if implementation checks pass.
- Fix direction: Set status back to `in_progress` while review issues are open. Only set `ready_to_merge` after a later Codex review reaches `READY_TO_MERGE`.

### ISSUE-3 [LOW] Manual UI checks are not recorded

- Location: `.review/cycle-30/plan.md:194`
- Analysis: The plan requires manual mobile/wide, light/dark, keyboard focus, 44px target, and reduced-motion checks. No cycle artifact records those results or an explicit headless limitation with automated/code evidence.
- Impact: Sprint Contract manual verification is incomplete.
- Fix direction: Run the manual checks and append exact results, or record the headless limitation plus concrete automated/code evidence in the RESOLVED section.

## Sprint Contract Check

- Watcher A evaluation is deterministic and pure: PASS, except active-snooze comparison needs epoch semantics from ISSUE-1.
- Armed date-threshold A watchers surface in Today when due: PASS.
- Future thresholds do not surface: PASS.
- `armed=0` watchers do not surface: PASS.
- Future `snoozed_until` hides a watcher: FAIL for mixed-offset RFC3339 values.
- Expired `snoozed_until` allows a watcher to surface again: PASS for covered same-offset cases.
- Malformed/unsupported watcher rules do not crash Today: PASS.
- Derived watcher bubbles contain stable reason/message fields and no hidden scalar priority score: PASS.
- Today watcher card exposes snooze action; successful snooze refreshes and removes the card: PASS for covered happy path, but blocked by ISSUE-1 for mixed-offset server evaluation.
- Failed snooze keeps the card visible and shows local error: PASS.
- Access-session handling remains consistent with existing `apiJson` flows: PASS by unchanged fetch boundary and existing coverage.
- No new LLM, cron, external network, migration, or write path from `GET /api/today`: PASS.
- `docs/codebase-map.md` is updated: PASS.
- Manual UI checks: FAIL, not recorded.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 103 PASS
  - server unit tests: 124 PASS
  - web unit tests: 242 PASS
  - shared build: PASS
  - server SQLite integration tests: 367 PASS
  - production build/PWA generation: PASS

## Changes Outside Plan

None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY (headless limitation + code evidence)

---

### Applied

RESOLVED: ISSUE-1 — epoch ms comparison for snooze filter
- `server/src/services/watchers.ts:52`: `nowMs = Date.parse(now)` computed once before loop.
- `server/src/services/watchers.ts:72-74`: `snoozedMs = Date.parse(row.snoozedUntil)` per row; `if (!Number.isNaN(snoozedMs) && snoozedMs > nowMs) continue;`. Invalid snoozedUntil (NaN) → fail-open (watcher surfaces).
- `server/src/services/watchers.test.ts`: 3 new tests — mixed-offset expired surfaces, mixed-offset future hidden, invalid snoozedUntil surfaces.
- `server/src/routes/watcher-evaluation.integration.test.ts`: 2 new tests — mixed-offset expired surfaces (09:30+09:00 = 00:30Z < 09:00Z), mixed-offset future hidden (19:00+09:00 = 10:00Z > 09:00Z).
자동 체크: verify ✅ shared 103 / server 127 / web 242 / integration 369

RESOLVED: ISSUE-2 — status.txt corrected
- `.review/cycle-30/status.txt`: changed from `ready_to_review` (invalid) to `in_progress`.

RESOLVED: ISSUE-3 — headless limitation + code evidence
- **Headless limitation**: This cycle runs on a Raspberry Pi with no display. Browser-based manual tests (mobile viewport, light/dark, keyboard focus, visual 44px) cannot be performed in this environment.
- **Code evidence (44px)**: `web/src/Today.tsx:1179` — snooze button has `style={{ marginTop: "8px", minHeight: "44px" }}` inline. CSS `.today-card` uses `padding: 16px 18px` with grid layout; button width fills the card width via block layout.
- **Code evidence (reduced-motion)**: `web/src/styles.css:770-779` — global `@media (prefers-reduced-motion: reduce)` rule sets `animation-duration: 1ms !important` on `*, *::before, *::after`. Covers `.today-card` `rise` animation (line 204) and all other card animations.
- **Code evidence (keyboard focus)**: The snooze button is a `<button>` element (Today.tsx:1177). Native button is keyboard-focusable by default. `aria-label` is set to `` `${w.label ?? "watcher"} 내일 다시 보기` `` for screen reader context.
- **Code evidence (light/dark)**: Watcher card uses `--moved` semantic token for border-left (`styles.css:208`), `--surface`/`--border` for background/border (`styles.css:196-205`). Both tokens are defined for light and dark themes via CSS custom properties. No hardcoded color values.
- **Automated coverage**: `web/src/Today.test.tsx` tests watcher card render, snooze success, snooze failure — all with `WatcherABubble` fixture.
