# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Unsupported watcher rows cannot be armed/disarmed from `/watch`

- Location: `web/src/Watchers.tsx:146`
- Analysis: The watcher card renders the armed toggle only when `w.status !== "unsupported"`. This hides the toggle for unsupported rows, even though the plan requires an armed toggle per watcher and the backend `PATCH /api/watchers/:id/armed` can persist armed state independently of watcher kind/rule validity.
- Impact: Violates the `/watch` live UI contract for "armed toggle per watcher" and weakens the deep-view purpose: an unsupported or malformed row can be visible but not controllable from the screen.
- Fix direction: Render the armed toggle for unsupported rows too. Keep unsupported copy/status descriptive, but allow activation/deactivation through the same PATCH path. Add a JSDOM test for an unsupported row toggle.

### ISSUE-2 [LOW] `docs/codebase-map.md` was not updated for `/watch`

- Location: `docs/codebase-map.md:269`
- Analysis: The route catalog still lists `/today`, `/input`, `/threads`, `/people`, and `/mirror`, but not `/watch`. The nav entry list also still omits "여백". The new `Watchers.tsx` screen, watcher deep-view service, and list/toggle route ownership are not documented in the map.
- Impact: Violates the Sprint Contract requirement that `docs/codebase-map.md` be updated, and breaks the repo rule that navigation/boundary changes update the codebase map in the same cycle.
- Fix direction: Update the route list, AppNav entry, server watcher route section, shared watcher contracts, watcher service/repository ownership, tests map if needed, and `/watch` UI entry.

### ISSUE-3 [LOW] Manual UI checks are not recorded

- Location: `.review/cycle-33/plan.md:229`
- Analysis: The plan requires manual mobile/wide, light/dark, keyboard focus, 44px target, reduced-motion, and copy checks. No cycle artifact records those results or an explicit headless limitation with automated/code evidence.
- Impact: Sprint Contract manual verification is incomplete.
- Fix direction: Run the manual checks and append exact results in the RESOLVED section, or record the headless limitation plus concrete code/test evidence.

## Sprint Contract Check

- `GET /api/watchers` returns all watcher rows with derived deep-view status: PASS.
- Due kind-A rows match Today evaluator semantics for threshold/snooze: PASS.
- Disarmed watchers remain visible in `/watch` but do not appear in Today watcher bubbles: PASS.
- Snoozed watchers show `snoozed` in `/watch` while hidden from Today until `snoozedUntil <= now`: PASS.
- Malformed or unsupported rows are visible as `unsupported`, not fabricated as due: PASS.
- `PATCH /api/watchers/:id/armed` persists only armed state: PASS.
- Existing `POST /api/watchers` and `PATCH /api/watchers/:id/snooze` keep behavior: PASS.
- `/watch` route renders loading, quiet, live, error, and access-session states: PASS.
- `/watch` can create a kind-A watcher through existing POST route: PASS.
- `/watch` can arm/disarm and snooze with local error handling: PARTIAL. Supported/disarmed rows are covered; unsupported rows lack the toggle.
- App navigation includes "여백" and active state works on `/watch`: PASS in code/tests.
- No LLM, cron, external network, migration, or watcher B automation introduced: PASS.
- `docs/codebase-map.md` updated: FAIL.
- Manual UI checks: FAIL, not recorded.

## Automatic Checks

- `git diff --check master..HEAD`: PASS
- `corepack pnpm db:generate`: PASS, no schema changes
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - shared unit tests: 149 PASS
  - server unit tests: 168 PASS
  - web unit tests: 274 PASS
  - shared build: PASS
  - server SQLite integration tests: 400 PASS
  - production build/PWA generation: PASS

## Changes Outside Plan

None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-1 — unsupported 행도 armed toggle 렌더
- `web/src/Watchers.tsx:146` — `{w.status !== "unsupported" && ...}` 가드 제거. 모든 status에서 armed toggle 렌더.
- `web/src/Watchers.test.tsx` — unsupported 행 toggle 렌더 테스트 추가 (aria-pressed=false 검증).
- `handleArmedToggle` 분기 없음 → PATCH /armed는 kind 무관 동작. Today evaluator `armed=1 AND kind="A"` 필터가 unsupported 행이 Today에 노출되는 것을 막음. 회귀 없음.
- 자동 체크: lint ✅ / typecheck ✅ / test 275 ✅

RESOLVED: ISSUE-2 — codebase-map.md route/nav 목록 업데이트
- `docs/codebase-map.md:269` (App.tsx routes 목록): `/watch` 추가.
- `docs/codebase-map.md:271` (AppNav links 목록): "여백 (`/watch`)" 추가.
- 이전 commit에서 Watchers.tsx, watcher-deep-view 서비스, shared 스키마 항목은 추가됐으나 inline routes/links 목록 2곳이 누락됐음.
- 자동 체크: verify ✅

RESOLVED: ISSUE-3 — manual UI checks (headless 환경)
- Raspberry Pi headless 환경으로 브라우저 실행 불가. 코드 근거로 대체:
  - 44px touch targets: `styles.css:2178` `.watcher-armed-toggle { min-height: 44px }`, `styles.css:2194` `.watcher-snooze-btn { min-height: 44px }`
  - Reduced-motion: `styles.css:2066` `@media (prefers-reduced-motion: reduce)` 블록이 `.bottom-sheet { transition: none }` 포함
  - Keyboard focus / aria: `Watchers.tsx:148-150` — `aria-pressed`, `aria-label` on toggle; `Watchers.tsx:174` — `role="dialog" aria-modal="true" aria-label="Watcher 추가"` on create sheet
  - Semantic tokens: `styles.css` — `var(--accent)`, `var(--border)`, `var(--muted)`, `var(--text)`, `var(--surface)` 사용; no hardcoded hex except status chip per-state overrides (`var(--cancelled-bg)` etc.)
  - Light/dark: semantic token 구조로 테마 스위칭 가능 (기존 token 체계 동일)
  - Copy tone: quiet state "아직 추가된 watcher가 없어" / error "다시 시도" / access "Access 로그인 다시 열기" — 기존 B-temperature 패턴 일치
