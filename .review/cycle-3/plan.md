# Google Calendar Inbound Sync Foundation Implementation Plan

Branch: `feature/cycle-3-gcal-inbound-sync`
Cycle: `3`
Created: `2026-06-16`
Skills: `backend-fastify`

## Summary

Implement inbound-only Google Calendar sync so external calendar events can
populate the local SQLite `events` table and appear in the existing
deterministic Today surface.

Cycle 3 adds local OAuth setup, one-shot sync scripts, idempotent GCal event
upsert, sync-token state, and real SQLite integration tests. It does not add
cron, UI, push, Gmail, GCal export/mirror, remote access, or LLM behavior.

Reference docs:
- Google Calendar `events.list`: https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- Google OAuth installed/desktop app loopback flow: https://developers.google.com/identity/protocols/oauth2/native-app

## Input/Output Spec

- Inputs:
  - `pnpm gcal:auth`
    - Uses local OAuth client credentials.
    - Requests scope `https://www.googleapis.com/auth/calendar.events.readonly`.
    - Stores local OAuth token under `.cairn/` by default.
  - `pnpm gcal:sync`
    - Requires `CAIRN_DB_PATH`.
    - Reads Google Calendar `primary` only.
    - Uses `CAIRN_TIME_ZONE`, default `Asia/Seoul`, for all-day date mapping.
- Outputs:
  - Successful sync upserts external events into SQLite `events`.
  - Sync state is stored in `params`:
    - `gcal.primary.syncToken`
    - optional `gcal.primary.lastSyncAt`
  - Failures exit non-zero with a clear message and do not fabricate events.

## Key Changes

- Cycle artifacts:
  - Keep `.review/cycle-3/status.txt` as `in_progress` during implementation.
  - Preserve Advisor feedback under `.review/cycle-3/advisor-feedback/`.
- Commands and local files:
  - Add root scripts and document them in `AGENTS.md`:
    - `pnpm gcal:auth`
    - `pnpm gcal:sync`
  - Add server dependency for Google API/OAuth client access.
  - Add `.cairn/` to `.gitignore`; store local OAuth credentials/tokens there
    by default.
- Database:
  - Add a Drizzle migration extending `events` with:
    - `external_calendar_id`
    - `external_event_id`
    - `external_ical_uid`
    - `external_etag`
    - `external_updated`
  - Add a unique index on `(external_calendar_id, external_event_id)`.
  - Do not mutate prior migrations.
- GCal sync:
  - Implement one-shot primary-calendar sync only; no HTTP endpoint and no cron.
  - Initial full sync window: `now - 30 days` through `now + 365 days`.
  - Subsequent sync uses `syncToken`.
  - On Google `410 Gone`, clear sync token and rerun full sync.
  - Handle `nextPageToken` pagination.
- Mapping:
  - `source='gcal'`
  - `self_imposed=0`
  - Google `confirmed` -> local `status='confirmed'`
  - Google `tentative` -> local `status='planned'`
  - Google `cancelled` -> local `status='cancelled'`
  - Missing `summary` becomes empty string.
  - Timed events preserve Google `dateTime`.
  - All-day `date` events map to `CAIRN_TIME_ZONE` midnight RFC3339 with
    `type='all_day'`.
- Delete policy:
  - Cancelled matched GCal events mark the local row `cancelled`.
  - Cancelled unmatched GCal events are skipped.
- Boundaries:
  - No GCal export or mirror recovery.
  - No Gmail, push, UI, remote access, auth boundary, or LLM behavior.
  - Do not import or call the LLM gateway from GCal sync code.

## Sprint Contract

- Passing conditions:
  - GCal inbound sync can import primary-calendar events into the local DB.
  - Re-running sync is idempotent by `(external_calendar_id, external_event_id)`.
  - Imported planned/confirmed events appear through existing `GET /api/today`.
  - Tests never touch the real Raspberry Pi DB.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- Required integration tests with temporary SQLite DBs and mocked Google clients:
  - Applies the new migration and verifies GCal identity columns/index exist.
  - Imports a confirmed timed event as `source='gcal'`, `self_imposed=0`.
  - Imports a tentative event as local `planned`.
  - Maps all-day events to midnight RFC3339 using `CAIRN_TIME_ZONE`.
  - Re-running the same GCal event updates the row instead of duplicating it.
  - Cancelled matched events become local `cancelled`.
  - Cancelled unmatched events are skipped.
  - Stores and reuses `nextSyncToken`.
  - Handles paginated `nextPageToken`.
  - Handles `410 Gone` by clearing token and performing full sync.
  - Proves imported planned/confirmed events appear through existing
    `GET /api/today`.
  - Proves no LLM gateway import is introduced in GCal sync code.
- Gas limit: N/A.
- Slither: N/A.

## Missing Edge Case Candidates

- Google returns an event with neither `start.dateTime` nor `start.date`.
- A sync page succeeds but a later page fails before `nextSyncToken` is stored.
- Local unique-index conflict occurs for malformed or duplicated external IDs.

## Simpler Alternative

Implement only mocked fixture import without real OAuth scripts. This would
validate mapping and idempotency faster, but it would not prove the intended
single-user Google Calendar operational path, so Cycle 3 includes local OAuth
and one-shot sync scripts.

## Assumptions

- User selected GCal inbound sync as Cycle 3 priority.
- User selected OAuth local token flow.
- User selected primary calendar only.
- User selected cancelled marker preservation instead of hard delete.
- User selected midnight mapping for all-day events.
- `CAIRN_DB_PATH` is required for `pnpm gcal:sync`.
- `GOOGLE_APPLICATION_CREDENTIALS` is not used; this is single-user OAuth, not
  a service account.
- Cron/interval sync is deferred until a later operations cycle.

## Review Guidance

### Enumeration Needed

- GCal identity schema:
  - Search: `rg -n "external_(calendar|event|ical|etag|updated)|uniqueIndex" server/src server/drizzle`
  - Expected: identity fields exist on `events`; unique index covers
    `(external_calendar_id, external_event_id)`.
- GCal command contract:
  - Search: `rg -n "gcal:auth|gcal:sync" package.json server/package.json AGENTS.md`
  - Expected: documented commands have matching package scripts.
- Inbound-only boundary:
  - Search: `rg -n "insert|import|export|mirror|calendar.events" server/src`
  - Expected: GCal code reads/imports only; no Cairn-to-GCal export or mirror
    recovery.
- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src`
  - Expected: no GCal sync module imports or calls the LLM gateway.

### Verification Guidance

- Migration and SQLite constraints require real temporary SQLite integration
  tests; mocks alone are insufficient.
- Google API behavior should be mocked at the client boundary. Do not call the
  live Google API in automated tests.
- OAuth script existence can be unit-checked, but real OAuth browser flow is a
  manual operational check and should not run in CI.
- Today visibility must be verified through the existing Fastify route with a
  temporary DB, not by testing the repository in isolation only.
