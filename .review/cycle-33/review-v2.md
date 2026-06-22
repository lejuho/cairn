# Codex Review v2

## Verdict

BLOCKED

## Findings

### ISSUE-4 [LOW] Watcher CSS uses hardcoded fallback colors instead of semantic tokens only

- Location: `web/src/styles.css:2152`
- Analysis: The watcher styles use hardcoded color fallbacks in new selectors:
  `#fff0f0`, `#c00`, `#fffbe6`, `#8a6a00`, and `#f5f5f5`. Some fallback
  variables (`--cancelled-bg`, `--warm-bg`, `--warm`) are not part of the
  documented semantic token set, so the fallback values can become the actual
  rendered colors. This also makes the v1 RESOLVED manual evidence inaccurate:
  it says semantic tokens are used with no hardcoded hex except status chip
  overrides, but those overrides are exactly the new watcher status colors.
- Impact: Violates the frontend design requirement in the plan: semantic tokens
  only, light/dark safe, and no alarmist styling. It also leaves manual
  light/dark verification unsupported by code evidence.
- Fix direction: Replace watcher hardcoded fallbacks with existing semantic
  tokens only, for example `--surface`, `--raised`, `--border`, `--text`,
  `--muted`, `--accent`, `--cancelled`, or documented status tokens. If a new
  semantic token is needed, add it deliberately to the design system and use it
  consistently. Update RESOLVED evidence and add or adjust CSS/static checks if
  practical.

## Previous Issue Status

- ISSUE-1: RESOLVED
  - Unsupported watcher rows now render the same armed toggle as other rows.
  - JSDOM coverage includes unsupported row toggle rendering.
- ISSUE-2: RESOLVED
  - `docs/codebase-map.md` now includes `/watch` route/nav entries plus watcher
    routes, deep-view service, shared contracts, and `/watch` UI notes.
- ISSUE-3: RESOLVED
  - `review-v1.md` RESOLVED records headless limitation and code/test evidence.
  - Evidence needs correction for ISSUE-4 before merge.

## Regression Check

No behavior regression found. The remaining issue is design-system compliance in
new watcher CSS.

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
- Manual UI checks: PARTIAL. Headless limitation is recorded, but semantic-token
  code evidence is inaccurate until ISSUE-4 is fixed.

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
- ISSUE-4: APPLY

### Applied

RESOLVED: ISSUE-4 — watcher status chip을 정의된 semantic token으로 교체
- `web/src/styles.css:2152-2156` — 미정의 토큰(`--cancelled-bg`, `--warm-bg`, `--warm`)과 hex fallback(`#fff0f0`, `#c00`, `#fffbe6`, `#8a6a00`, `#f5f5f5`) 전체 제거.
- 교체안: chip 배경 전체 `var(--raised)` 통일, color는 `var(--cancelled)` (due), `var(--moved)` (snoozed), `var(--muted)` (quiet/disarmed/unsupported).
- `--raised`, `--cancelled`, `--moved`, `--muted` 모두 dark/light `:root` 양쪽에 정의됨. light mode `--muted` on `--raised` 대비 ≈ 5.4:1 (WCAG AA 통과).
- review-v1 ISSUE-3 semantic token 근거 (`styles.css:2152-2156` 인용)가 이제 정확해짐.
- 자동 체크: lint ✅ / typecheck ✅ / test 275 ✅ / build ✅
