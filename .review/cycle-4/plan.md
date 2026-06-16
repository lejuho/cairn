# Cycle 4 — Annotation Intake + LLM Parse Fallback

Branch: `feature/cycle-4-annotation-intake`
Cycle: `4`
Created: `2026-06-16`
Skills: `backend-fastify`

## Summary

Prepare Cycle 4 to implement the first push-answer intake path without adding
a real push channel. The cycle adds a local backend API that accepts a one-line
reply for an existing event, stores the raw text in `annotations.reason_text`
first, attempts structured parsing through the existing LLM gateway, and
gracefully keeps raw-only data when the proxy is unavailable or returns invalid
structure.

Out of scope: Telegram/Web Push delivery, frontend UI, Gmail parsing, thread
generation, GCal export/mirror, cron, remote access, auth boundary, new
annotation tables/columns.

This preparation pass creates only:
- `.review/cycle-4/status.txt` with `in_progress`
- `.review/cycle-4/plan.md`
- `.review/cycle-4/advisor-feedback/` directory

Then stop before code changes.

## Input/Output Spec

- Input:
  - endpoint: `POST /api/events/:id/annotations`
  - content-type: `application/json`
  - body: `{ "text": string }`
  - `text` must be non-empty after trim.
  - `id` must be a positive integer and must reference an existing event.
  - auth: none, consistent with current local-only cycles.
- Output:
  - Success after parsed annotation:
    - `{ ok: true, data: { annotation, parseStatus: "parsed" } }`
    - Side effects:
      - raw annotation is inserted first.
      - structured annotation fields are updated after validated LLM parse.
      - if parsed `outcome` is present, linked `events.status` is updated to
        the same lowercase value.
  - Success after raw fallback:
    - `{ ok: true, data: { annotation, parseStatus: "raw_stored", llmError } }`
    - Side effects:
      - raw annotation remains stored in `annotations.reason_text`.
      - structured fields remain null.
      - linked `events.status` is not updated.
  - Failure:
    - `400 VALIDATION_ERROR` for invalid id/body.
    - `404 NOT_FOUND` for missing event.

## API And Behavior

- On every valid request:
  - Insert an annotation row first with `event_id=<id>`,
    `reason_text=<raw text>`, and structured fields null.
  - Then call the LLM gateway to parse the raw text.
- Expected parsed JSON shape from the model:
  - `outcome`: optional `done | cancelled | moved | late`
  - `reasonTags`: string array, default `[]`
  - `energyAtTime`: optional integer `1..5`
  - `reasonText`: optional string; default raw text
- If parsing succeeds:
  - Update the inserted annotation with validated structured fields.
  - If `outcome` is present, update the linked `events.status` to the same
    lowercase value.
  - Return `{ ok: true, data: { annotation, parseStatus: "parsed" } }`.
- If the LLM proxy is unavailable, rate-limited, times out, or returns invalid
  JSON/schema:
  - Keep the raw annotation row.
  - Do not update `events.status`.
  - Return `{ ok: true, data: { annotation, parseStatus: "raw_stored", llmError } }`.

## Key Changes

- Shared schemas:
  - Add Zod schemas/types for annotation intake request, annotation row, parse
    status, and typed API response.
- Server implementation:
  - Add repository/service/route for annotation intake.
  - Keep the route thin: validate params/body, call one service boundary, map
    result.
  - The service owns transaction order: raw insert first, best-effort LLM parse
    second, structured update only after validation.
  - Use the existing LLM gateway only; no direct proxy URL or Grok call outside
    `server/src/llm`.
- Database:
  - Do not add migrations unless implementation proves the existing
    `annotations` table cannot support the contract.
- Boundaries:
  - No Telegram/Web Push delivery.
  - No frontend UI.
  - No Gmail parsing.
  - No thread generation.
  - No GCal export/mirror.
  - No cron.
  - No remote access or auth boundary.

## Sprint Contract

- Passing conditions:
  - `POST /api/events/:id/annotations` stores raw text before any LLM parse.
  - Successful parse fills structured annotation fields.
  - Parsed `outcome` updates linked `events.status`.
  - Proxy outage or invalid parse keeps raw annotation and does not throw into
    deterministic routes.
  - No real push channel is added.
  - No migration is added unless required by implementation constraints.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- Integration tests with temporary SQLite DB:
  - rejects non-positive event id
  - rejects empty text
  - returns 404 for missing event
  - stores raw annotation before parse
  - successful parse fills `outcome`, `reason_tags`, `energy_at_time`,
    `reason_text`
  - successful parsed `outcome` updates `events.status`
  - ambiguous parse with no outcome keeps event status unchanged
  - proxy unavailable returns `parseStatus="raw_stored"` and preserves raw text
  - invalid LLM JSON/schema returns `raw_stored`
  - deterministic routes such as `/health` and `/api/today` still work without
    proxy
- Gas limit: N/A.
- Slither: N/A.

## Missing Edge Case Candidates

- LLM returns valid JSON with an unknown `outcome` or out-of-range
  `energyAtTime`.
- Raw insert succeeds but structured update fails after LLM success.
- Multiple annotations are submitted for the same event in quick succession.

## Simpler Alternative

Store raw annotations only and defer LLM parsing. This would reduce Cycle 4
risk, but it would not exercise the approved FR-SYNC-04 narrow LLM path or the
proxy-failure fallback contract, so this cycle includes best-effort parsing.

## Assumptions

- Cycle 4 priority is Annotation Intake.
- Real push delivery remains deferred; this cycle simulates push replies
  through a local API.
- Existing `annotations.reason_text` is the raw-text fallback store.
- LLM parsing is allowed in this cycle because FR-SYNC-04 is an approved narrow
  LLM use.
- `mock: true` is allowed only in tests through the existing gateway contract.
- No frontend work is included in Cycle 4.

## Review Guidance

### Enumeration Needed

- Annotation API contract:
  - Search: `rg -n "annotations|parseStatus|raw_stored|POST /api/events" server/src shared/src`
  - Expected: shared schemas, one route, repository/service code, and
    integration coverage.
- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src`
  - Expected: annotation parsing uses the gateway; no route/repository direct
    proxy URL usage.
- Push boundary:
  - Search: `rg -n "telegram|webpush|push|cron|schedule" server/src web/src package.json`
  - Expected: no real push channel, cron, or frontend push implementation in
    Cycle 4.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration unless implementation documents why the current
    `annotations` table is insufficient.

### Verification Guidance

- Raw-first behavior requires real temporary SQLite integration tests; mocks
  alone are insufficient.
- LLM success/failure should be mocked at the gateway boundary.
- Deterministic route availability must be verified with the gateway absent or
  unavailable.
- Event status side effects must be checked against the database row, not only
  the API response.
