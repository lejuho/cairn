# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Preview UI path lacks required frontend coverage

- Location: `web/src/Today.test.tsx:1991`
- Analysis: The new Today feasibility settings tests cover opening the sheet, rendering sliders, cancel, apply success, save failure, and backdrop close. They do not cover the core preview path: slider change sending `POST /api/feasibility/day/preview`, rendering the preview result, preview failure keeping the sheet open with an alert, or stale/aborted preview behavior. A search for `day/preview` and `미리보기` only finds implementation code in `web/src/Today.tsx`, not assertions in `web/src/Today.test.tsx`.
- Impact: Violates Sprint Contract frontend test cases for "slider change calls preview route", "preview result renders without changing Today surface", and "preview failure keeps sheet open with alert". This is the central new behavior of the cycle, so unit/integration green is not enough.
- Fix direction: Add JSDOM tests that open the sheet, change one slider, advance the debounce timer or otherwise await the preview call, assert the preview request body uses the draft params and current surface date/now, assert preview output renders, assert failed preview leaves the sheet open with `role="alert"`, and cover stale/abort behavior or document why AbortController coverage is sufficient.

### ISSUE-2 [LOW] Cycle status file uses an invalid state

- Location: `.review/cycle-31/status.txt:1`
- Analysis: The file contains `ready_to_review`, but AGENTS allows only `in_progress`, `ready_to_merge`, or `escalated`.
- Impact: Violates cycle status contract and blocks merge readiness even when automatic checks pass.
- Fix direction: Set status back to `in_progress` while review issues are open. Only set `ready_to_merge` after a later Codex review reaches `READY_TO_MERGE`.

### ISSUE-3 [LOW] Manual UI checks are not recorded

- Location: `.review/cycle-31/plan.md:255`
- Analysis: The plan requires manual mobile/wide, light/dark, keyboard focus through open/sliders/apply/cancel/close, 44px targets, and reduced-motion checks. No cycle artifact records those results or an explicit headless limitation with automated/code evidence.
- Impact: Sprint Contract manual verification is incomplete.
- Fix direction: Run the manual checks and append exact results, or record the headless limitation plus concrete automated/code evidence in the RESOLVED section.

## Sprint Contract Check

- `GET /api/feasibility/params` returns effective params, defaults, and slider limits: PASS.
- `PUT /api/feasibility/params` validates and persists canonical keys atomically: PASS.
- Invalid update does not partially write: PASS.
- `POST /api/feasibility/day/preview` computes with supplied params and does not write: PASS.
- Existing Today and `/api/feasibility/day` reflect saved values: PASS.
- Mirror energy trend route reflects saved energy budget: PASS by existing DB-param route coverage; no new PUT-to-Mirror integration was added.
- Today settings sheet shows five sliders with live values: PASS.
- Slider changes request preview without persisting: UNVERIFIED in frontend tests.
- Apply persists and refreshes Today: PASS.
- Cancel/close does not persist: PASS.
- Failed save keeps sheet open with local error: PASS.
- Failed preview keeps sheet open with local error: UNVERIFIED in frontend tests.
- Access-session behavior remains consistent with existing `apiJson` flows: PASS by unchanged fetch boundary; no new dedicated settings-sheet access-session test.
- No LLM, cron, external network, or migration is introduced: PASS.
- `docs/codebase-map.md` is updated: PASS.
- Manual UI checks: FAIL, not recorded.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 121 PASS
  - server unit tests: 133 PASS
  - web unit tests: 248 PASS
  - shared build: PASS
  - server SQLite integration tests: 381 PASS
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

RESOLVED: ISSUE-1 — added 4 preview path frontend tests
- `web/src/Today.test.tsx`: 4 new tests in "Today — feasibility settings sheet" describe:
  1. "slider change sends POST preview with draft params and surface date/now" — opens sheet, changes energy slider to 10, advances debounce timer (`vi.useFakeTimers()` → `vi.runAllTimersAsync()` inside `act`), asserts POST `/api/feasibility/day/preview` sent with `{params: {energyBudget: 10}, date: "2026-06-16", now: "2026-06-16T09:00:00.000Z"}`.
  2. "preview result renders inside the sheet" — same flow, asserts `aria-label="미리보기 결과"` and `"2.0h / 10h"` text visible.
  3. "preview failure shows role=alert and keeps sheet open" — mock returns `{ok: false, error: {message: "preview 오류"}}`, asserts `role="alert"` with error text, dialog still present.
  4. "rapid slider changes cancel stale — only last preview POST fires" — first change at t=0, advance 100ms, second change resets debounce, `runAllTimersAsync` drains only second timer, asserts exactly 1 POST with `energyBudget=10`.
- Pattern: initial render/waitFor with real timers → `vi.useFakeTimers()` only for debounce step → `act(runAllTimersAsync)` → `vi.useRealTimers()` (also in describe-level afterEach as belt-and-suspenders).
자동 체크: verify ✅ shared 121 / server 133 / web 252 / integration 381

RESOLVED: ISSUE-2 — status.txt corrected to `in_progress`.

RESOLVED: ISSUE-3 — headless limitation + code evidence
- **Headless limitation**: Raspberry Pi with no display. Browser-based manual checks (mobile/wide viewport, light/dark, keyboard focus, visual 44px, slider drag) cannot be performed in this environment.
- **Code evidence (44px slider touch target)**: `web/src/styles.css:1343` — `.feas-slider { height: 44px; }` explicitly sets the touch-target height. The apply and cancel buttons each have `min-height: 44px` (`styles.css:1415`, `1424`).
- **Code evidence (reduced-motion)**: `web/src/styles.css:1432–1435` — `@media (prefers-reduced-motion: reduce)` block sets `transition: none` on both webkit and moz slider thumbs. Global reduced-motion rule at `styles.css:770–779` also covers all animations (`animation-duration: 1ms !important`).
- **Code evidence (keyboard focus)**: slider is `<input type="range">` (natively keyboard-focusable, arrow keys change value). `.feas-slider:focus-visible` has explicit `outline: 2px solid var(--accent)` (`styles.css:1379`). Apply and cancel are `<button>` elements (natively focusable). Sheet close button is `<button>` with `aria-label="닫기"`.
- **Code evidence (light/dark)**: All sheet elements use semantic tokens: `--surface`, `--border`, `--text`, `--muted`, `--raised`, `--accent`, `--cancelled`. No hardcoded color values.
- **Automated coverage**: `web/src/Today.test.tsx` — slider renders, preview, apply, cancel, backdrop, save failure, 10 total sheet tests.
