# Cycle 12 — Flat One-Line Capture

Branch: `feature/cycle-12-flat-quick-capture`
Cycle: `12`
Created: `2026-06-17`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Implement the second input path from `docs/cairn-spec.md`: a low-friction one
line capture that turns a short natural-language note into exactly one flat
event. This is not thread generation. It does not create dependencies, links,
or multi-node drafts.

The cycle adds a local API and Today UI quick-capture input. The parser may use
the existing LLM gateway because this is a narrow parsing/translation task, but
it must degrade without data loss: if parsing fails or the proxy is unavailable,
store the raw text as an unscheduled Cairn event with `start=NULL` and `end=NULL`.

Out of scope:
- Natural-language thread generation (`FR-THR-02`)
- Slot suggestion UI or scheduling candidates (`FR-SLOT`)
- Multi-event parsing
- Task quick capture
- Recurring events
- GCal export/mirror
- New DB tables or migrations
- Real Grok calls in tests
- App-level auth changes

## 입력/출력 명세

- `POST /api/capture/flat-event`
  - Request: `{ "text": string, "now"?: string, "timeZone"?: string }`
  - Validation:
    - `text` must be non-empty after trim.
    - `now`, if present, must be an RFC3339 datetime with offset.
    - `timeZone`, if present, must be a non-empty string.
  - Behavior:
    - Treat the input as one flat event only.
    - Call a new LLM parser through the existing server LLM gateway.
    - Never create a thread, task, link, or thread link.
    - Persist `source='cairn'`, `self_imposed=1`, `status='planned'`.
  - Successful scheduled parse:
    - Parsed shape includes `title` and `start`.
    - Insert one event.
    - If `end` is missing, default to `start + 60 minutes`.
    - Return `{ ok: true, data: { event, captureStatus: "scheduled" } }`.
  - Successful unscheduled parse:
    - Parsed shape has a useful `title` but no `start`.
    - Insert one event with `start=NULL`, `end=NULL`.
    - Return `{ ok: true, data: { event, captureStatus: "unscheduled" } }`.
  - Parser unavailable, timed out, rate-limited, invalid JSON, or invalid schema:
    - Insert one event with `title=<raw trimmed text>`, `start=NULL`, `end=NULL`.
    - Return `{ ok: true, data: { event, captureStatus: "raw_stored", llmError } }`.
  - Failure:
    - `400 VALIDATION_ERROR` for invalid request shape.

- Today quick capture UI:
  - Render a compact one-line input on `/today` in quiet and live states.
  - Empty submission is rejected client-side.
  - Valid submission posts to `/api/capture/flat-event`, then refetches Today.
  - Scheduled capture appears in Today timeline/cards if it lands on the active
    Today date.
  - Raw/unscheduled capture shows a local success note that the item was saved
    without a date.

## Key Changes

- Shared:
  - Add Zod schemas/types for flat capture request, capture status, parser
    result, and API response data.
  - Export schemas from the shared barrel.
- Backend:
  - Add a parser module under `server/src/llm` for flat event capture.
  - Add repository support to insert unscheduled events (`start=NULL`,
    `end=NULL`) without weakening the existing `POST /api/events` contract.
  - Add a service boundary that owns parse/fallback/persist order.
  - Add a thin route `POST /api/capture/flat-event`.
  - Register the route only when DB and LLM gateway are available; if gateway
    returns unavailable, service must still raw-store the event.
  - Keep Today aggregation deterministic; no Today route/service LLM import.
- Frontend:
  - Add quick-capture input to Today quiet and live surfaces.
  - Submit via relative `/api/capture/flat-event`.
  - Preserve existing manual bottom-sheet intake.
  - Preserve loading, quiet, live, error, timeline, thread-picker, and
    annotation behaviors.
- Docs:
  - Update `docs/codebase-map.md` with the new shared contract, route/service,
    LLM parser boundary, and Today quick-capture surface.

## Sprint Contract

- 통과 기준:
  - `POST /api/capture/flat-event` rejects empty text with typed
    `400 VALIDATION_ERROR`.
  - Scheduled parse inserts exactly one event with `source='cairn'`,
    `self_imposed=1`, `status='planned'`, no `threadId`, and no links.
  - Missing parsed `end` defaults to `start + 60 minutes`.
  - Parse with no start inserts one unscheduled event with `start=NULL` and
    `end=NULL`.
  - LLM unavailable/timeout/rate-limit/invalid JSON/invalid schema raw-stores
    the trimmed input as an unscheduled event.
  - Scheduled captures for the Today date appear through existing
    `GET /api/today`.
  - Unscheduled captures do not appear in `dayEvents` until later slot
    assignment.
  - Today quick capture posts valid text, refetches Today, and shows a saved
    message for raw/unscheduled outcomes.
  - Today quick capture empty submit does not call fetch.
  - No thread, task, link, or `thread_links` row is created by flat capture.
  - No DB migration is added.
  - No direct proxy URL or Grok call outside `server/src/llm`.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- 테스트 케이스:
  - Backend integration: rejects empty text.
  - Backend integration: scheduled parse inserts one linked-to-nothing event.
  - Backend integration: parsed missing end defaults to 60 minutes.
  - Backend integration: no-start parse inserts unscheduled event.
  - Backend integration: LLM unavailable raw-stores unscheduled event.
  - Backend integration: invalid LLM JSON/schema raw-stores unscheduled event.
  - Backend integration: scheduled capture appears in `GET /api/today`.
  - Backend integration: unscheduled capture is persisted but excluded from
    `dayEvents`.
  - Boundary test/enumeration: no Today service/route LLM import.
  - Frontend test: quick capture renders in quiet and live states.
  - Frontend test: empty submit does not call fetch.
  - Frontend test: successful scheduled submit calls capture endpoint and
    refetches Today.
  - Frontend test: raw/unscheduled outcome displays saved-without-date message.
  - Frontend regression: existing manual task/event forms still work.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- The LLM returns multiple items from one input; service must reject the shape
  and raw-store the original text instead of creating multiple events.
- The LLM returns a start without timezone offset; schema validation must fail
  and raw-store, not guess timezone silently.
- The user enters a long project-like paragraph into flat capture; this route
  still stores one raw unscheduled event and must not create a thread draft.

## 더 단순한 대안 1개

Add a plain text box that always stores raw unscheduled events without LLM
parsing. This is safer and simpler, but it does not implement `FR-SYNC-02`
because timed one-line inputs such as "내일 3시 치과" would never land on the
calendar without a second action.

## Assumptions

- Cycle 12 priority is the spec's flat one-line input path.
- LLM use is allowed here because it is parsing/translation, not deterministic
  aggregation or automatic decision mutation.
- `events.start` and `events.end` are nullable in the DB schema, so no migration
  is expected.
- Existing `POST /api/events` should remain strict and scheduled-only.
- Raw fallback title is user-authored text, not fabricated output.
- Default event duration for parsed start without end is 60 minutes.
- `timeZone` default can be `CAIRN_TIME_ZONE` or `Asia/Seoul`; tests should pass
  explicit values when behavior depends on it.

## Review Guidance

### Enumeration 필요 항목

- New capture surface:
  - Search: `rg -n "flat-event|captureStatus|FlatCapture|quick capture|빠른" shared/src server/src web/src`
  - Expected: shared schemas, server route/service/parser, web Today UI/tests.
- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src web/src`
  - Expected: new parsing code only under `server/src/llm` or service boundary
    using the gateway abstraction; no direct proxy URL in routes/repositories.
- Deterministic Today boundary:
  - Search: `rg -n "from .*llm|completeChat|capture" server/src/routes/today.ts server/src/services/today.ts`
  - Expected: no LLM import/call in Today route/service.
- No thread/link creation:
  - Search: `rg -n "threadId|links|thread_links|createThread|createTask" server/src/routes server/src/services server/src/repositories`
  - Expected: flat capture inserts only into `events`, with `threadId` null.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration.
- Codebase map:
  - Search: `rg -n "flat-event|quick capture|captureStatus" docs/codebase-map.md`
  - Expected: map documents route/service/parser/UI entry points.

### 검증 방식 가이드

- Event persistence and absence of thread/link rows require real temporary
  SQLite integration tests.
- LLM parse success/failure should use mocked gateway responses only.
- UI behavior can be verified with Vitest component tests and mocked fetch.
- Reviewer should treat any multi-node or thread-generation behavior as scope
  creep.
