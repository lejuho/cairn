# Codex Review v1

## Verdict
BLOCKED

## Findings

### ISSUE-1 [HIGH] All-day GCal events are stored under the previous UTC date, so Today misses them
- Location: `server/src/gcal/mapping.ts:89`
- Analysis: `allDayToMidnightRfc3339("2026-06-16", "Asia/Seoul")` returns a UTC string such as `2026-06-15T15:00:00.000+00:00`. That instant is local midnight in Seoul, but Cycle 2 Today filtering intentionally uses a literal `YYYY-MM-DD` prefix check on stored `events.start`. The current test locks in the previous-date UTC representation at `server/src/gcal/gcal.integration.test.ts:144`, so it does not catch the Today mismatch.
- Impact: The Sprint Contract says all-day events map to `CAIRN_TIME_ZONE` midnight and imported planned/confirmed events appear through existing `GET /api/today`. For an all-day event dated `2026-06-16`, `/api/today?date=2026-06-16` will not see a stored start beginning with `2026-06-15`.
- Fix direction: Store all-day dates in an RFC3339 string whose date prefix remains the Google date in the selected timezone, e.g. `2026-06-16T00:00:00+09:00` for `Asia/Seoul`. Keep DST-aware offset calculation for zones that need it. Update tests to assert the local-date prefix and add a route integration case proving an all-day imported event appears in `GET /api/today` for the original GCal date.

## Sprint Contract Check

- GCal inbound sync imports primary-calendar events into local DB: PASS.
- Idempotent sync by `(external_calendar_id, external_event_id)`: PASS.
- Imported planned/confirmed timed events appear through `GET /api/today`: PASS.
- Imported all-day events appear through `GET /api/today` on their GCal date: FAIL, see ISSUE-1.
- Tests avoid real Raspberry Pi DB and use temporary SQLite files: PASS.
- Migration adds GCal identity columns and unique index: PASS.
- Confirmed/tentative/cancelled mapping: PASS.
- Cancelled matched/unmatched policy: PASS.
- Sync token storage/reuse, pagination, and `410 Gone` full resync: PASS.
- No LLM gateway import in GCal sync code: PASS by source inspection.
- Command contract for `gcal:auth` and `gcal:sync`: PASS.

## Automatic Checks

- `corepack pnpm db:generate`: PASS
- `corepack pnpm test:integration`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check master...HEAD`: PASS

## Changes Outside Plan

None detected.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY — Sprint Contract "all-day events appear in GET /api/today for GCal date" 실패. 명백한 버그.

### Applied

RESOLVED: ISSUE-1 — all-day GCal 이벤트를 local-offset RFC3339 형식으로 저장
- `server/src/gcal/mapping.ts`: `allDayToMidnightRfc3339` return 변경
  - 기존: `new Date(utcMs).toISOString().replace("Z", "+00:00")` → `"2026-06-15T15:00:00.000+00:00"`
  - 수정: `` `${date}T00:00:00${sign}${hh}:${mm}` `` → `"2026-06-16T00:00:00+09:00"`
  - offset = (Date.UTC(y,m-1,d,0,0,0) − utcMs) / 60000. findMidnightUtcMs는 그대로 유지 (Intl DST-safe)
- `server/src/gcal/gcal.integration.test.ts`: 기존 UTC prefix 어서션 3개 local-offset 형식으로 업데이트. UTC/Kolkata(+05:30)/NewYork(-04:00) 케이스 추가. Today all-day route 통합 테스트 추가.
자동 체크: lint ✅ / typecheck ✅ / test ✅ / test:integration 45 passed ✅ / build ✅
