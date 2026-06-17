# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] `/input` event form stores local datetime as UTC
- Location: `web/src/InputHub.tsx:257`
- Analysis: The event form converts `datetime-local` values with `v + ":00+00:00"`. This treats a local user-selected time as UTC. Existing Today manual event intake uses local timezone offset via `datetimeLocalToRfc3339`, and the Cycle 14 plan says `/input` should reuse current Today validation rules.
- Impact: In KST, entering `2026-06-20T10:00` stores `2026-06-20T10:00:00+00:00`, shifting the intended local event by nine hours. This breaks the user-input hub's manual event contract.
- Fix Direction: Use the same local-offset serialization helper as Today, or extract a shared frontend helper used by both Today and InputHub. Add a test that stubs `Date.prototype.getTimezoneOffset` and asserts `+09:00` output for KST.

### ISSUE-2 [MEDIUM] `/input` uses UTC date for Today and slot candidate requests
- Location: `web/src/InputHub.tsx:37`
- Analysis: `todayDate()` returns `nowRfc3339().slice(0, 10)`, where `nowRfc3339()` is based on `toISOString()`. This derives the UTC date, not the user's local date. Today already uses a local date helper for `GET /api/today`.
- Impact: For Asia/Seoul before 09:00, `/input` asks for the previous UTC date. Slot candidate requests also start from that wrong date, so the hub can show/suggest dates one local day behind.
- Fix Direction: Use a local date helper matching Today for both `GET /api/today` and slot candidate requests. Add a timezone-sensitive frontend test.

### ISSUE-3 [MEDIUM] Quick capture failures do not show a local error
- Location: `web/src/InputHub.tsx:97`
- Analysis: On failed `POST /api/capture/flat-event`, the catch branch only clears `submitting` and `savedMsg`. No error state is rendered for quick capture.
- Impact: Sprint Contract requires failed quick capture/manual add/candidate load/schedule actions to keep the relevant input visible and show local error. Manual add and slot actions do this; quick capture does not.
- Fix Direction: Add a quick-capture error field, render it as `role="alert"`, and add a test for failed capture preserving input plus showing error.

## Sprint Contract Check
- `/today`, `/input`, `/threads`, `/threads/new`, and `/threads/:id` render app navigation: PASS
- Navigation has links to `/today`, `/input`, `/threads`: PASS
- Current route sets `aria-current="page"`: PASS
- `/input` quick capture posts to `POST /api/capture/flat-event`: PASS
- `/input` quick capture empty submit does not call fetch: PASS
- `/input` manual event form posts to `POST /api/events`: FAIL, wrong timezone semantics
- `/input` manual task form posts to `POST /api/tasks`: PASS
- `/input` thread picker uses `GET /api/threads` and degrades gracefully: PASS
- `/input` lists unscheduled events from Today `unscheduledEvents`: PASS
- `/input` can load slot candidates and schedule an unscheduled event: PASS, but date basis can be wrong around local midnight
- Failed quick capture/manual add/candidate load/schedule actions keep the relevant input visible and show local error: FAIL for quick capture
- Today still renders quick capture and existing schedule prompt cards: PASS
- No LLM imports are added to deterministic Today or slot code: PASS
- No DB migration is added: PASS
- `docs/codebase-map.md` is updated: PASS

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm test:integration`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check`: PASS

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-1 — event form uses local timezone offset via `datetimeLocalToRfc3339`
- Extracted `datetimeLocalToRfc3339`, `localDateString`, `localNowRfc3339` to `web/src/dateUtils.ts`
- `InputHub.tsx` event form start/end now calls `datetimeLocalToRfc3339(v)` instead of `v + ":00+00:00"`
- `Today.tsx` imports helpers from `dateUtils.ts` (removed inline duplicates)
- Test updated: stubs `Date.prototype.getTimezoneOffset` to return -540 (KST), asserts `+09:00` offset in POST body

RESOLVED: ISSUE-2 — `todayDate()` and slot candidate requests now use local date
- Removed `nowRfc3339()` / `todayDate()` helpers from `InputHub.tsx`
- `loadData()` and `handleLoadCandidates()` now call `localNowRfc3339()` + `localDateString()`
- `localDateString()` uses `getDate()`/`getMonth()`/`getFullYear()` (local timezone), not `toISOString()` (UTC)
- Test: stubs `Date.prototype.getDate/getMonth/getFullYear/getTimezoneOffset`, asserts `date=2026-06-20` in request URL

RESOLVED: ISSUE-3 — quick capture failure renders local error
- Added `error: string | null` to `CaptureState`
- `catch` branch sets `capture.error` with the error message
- Rendered as `<p role="alert">` below the capture form
- Test: asserts `role="alert"` and input still visible on capture API failure

자동 체크: lint ✅ / typecheck ✅ / test ✅ (84 web, 132 integration) / build ✅ / git diff --check ✅
