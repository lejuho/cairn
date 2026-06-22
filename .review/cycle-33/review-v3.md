# Codex Review v3

## Verdict

BLOCKED

## Findings

### ISSUE-4 [LOW] Watcher CSS still has hardcoded fallback colors

- Location: `web/src/styles.css:2182`, `web/src/styles.css:2206`
- Analysis: The v2 RESOLVED response fixed the watcher status chips at
  `web/src/styles.css:2152-2156`, but the same new watcher CSS block still has
  hardcoded color fallbacks:
  - `.watcher-armed-toggle` uses `background: var(--surface, #f5f5f5);`
  - `.watcher-row-error` uses `color: var(--cancelled, #c00);`
  The RESOLVED text says the hex fallbacks were removed, but these two
  remaining declarations can still render fallback hex values if the semantic
  token is unavailable.
- Impact: The Sprint Contract requirement for semantic design tokens only is
  still not fully satisfied. This also keeps the manual light/dark evidence
  weaker than the code evidence needs to be before merge.
- Fix direction: Remove the fallback literals from the watcher CSS declarations,
  for example:
  - `background: var(--surface);`
  - `color: var(--cancelled);`
  Then append a new RESOLVED entry under this file's boundary.

## Previous Issue Status

- ISSUE-1: RESOLVED
  - Unsupported watcher rows render the same armed toggle as other rows.
  - JSDOM coverage includes unsupported row toggle rendering.
- ISSUE-2: RESOLVED
  - `docs/codebase-map.md` includes `/watch` route/nav entries plus watcher
    routes, deep-view service, shared contracts, and `/watch` UI notes.
- ISSUE-3: RESOLVED
  - `review-v1.md` RESOLVED records the headless limitation and code/test
    evidence.
- ISSUE-4: UNRESOLVED
  - Status chips were fixed, but watcher toggle/error styles still contain hex
    fallbacks.

## Regression Check

No behavior regression found. The remaining blocker is still design-token
compliance in the watcher CSS.

## Sprint Contract Check

- `GET /api/watchers` returns all watcher rows with derived deep-view status:
  PASS.
- Due kind-A rows match Today evaluator semantics for threshold/snooze: PASS.
- Disarmed watchers remain visible in `/watch` but do not appear in Today
  watcher bubbles: PASS.
- Snoozed watchers show `snoozed` in `/watch` while hidden from Today until
  `snoozedUntil <= now`: PASS.
- Malformed or unsupported rows are visible as `unsupported`, not fabricated as
  due: PASS.
- `PATCH /api/watchers/:id/armed` persists only armed state: PASS.
- Existing `POST /api/watchers` and `PATCH /api/watchers/:id/snooze` keep
  behavior: PASS.
- `/watch` route renders loading, quiet, live, error, and access-session states:
  PASS.
- `/watch` can create a kind-A watcher through existing POST route: PASS.
- `/watch` can arm/disarm and snooze with local error handling: PASS.
- App navigation includes "여백" and active state works on `/watch`: PASS.
- No LLM, cron, external network, migration, or watcher B automation introduced:
  PASS.
- `docs/codebase-map.md` updated: PASS.
- Manual UI checks: PARTIAL. Headless/manual evidence is recorded, but the
  watcher CSS still has semantic-token violations in two declarations.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 149 PASS
  - server unit tests: 168 PASS
  - web unit tests: 275 PASS
  - shared build: PASS
  - server SQLite integration tests: 400 PASS
  - production build/PWA generation: PASS

## Changes Outside Plan

None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-4 (continuation): APPLY

### Applied

RESOLVED: ISSUE-4 (final) — 나머지 hex fallback 2개 제거
- `web/src/styles.css:2182`: `var(--surface, #f5f5f5)` → `var(--surface)`
- `web/src/styles.css:2206`: `var(--cancelled, #c00)` → `var(--cancelled)`
- watcher CSS 블록 전체에 hex 리터럴 및 `var(...)` fallback 0개. `--surface`/`--cancelled`/`--moved`/`--raised`/`--muted`/`--text`/`--border`/`--accent` 모두 dark/light `:root` 양쪽 정의 확인.
- 자동 체크: lint ✅ / typecheck ✅ / test 275 ✅ / build ✅
