# Cycle 13 — Slot Suggestion A for Unscheduled Events

Branch: `feature/cycle-13-slot-suggestion-a`
Cycle: `13`
Created: `2026-06-17`
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 12 created flat one-line capture and can store unscheduled Cairn events
with `start=NULL` and `end=NULL`. Cycle 13 closes the next loop from
`FR-SLOT`: surface those unscheduled events in Today, generate deterministic
conflict-free candidate slots, and let the user choose one to assign
`events.start` and `events.end`.

This is Slot Suggestion A, not the full slot engine. It handles unscheduled
`events` only, uses simple deterministic availability windows, and never
auto-schedules without user selection.

Out of scope:
- Unscheduled tasks
- Friction/flake scoring from annotations
- People preference windows
- Thread-aware context-switch scoring
- Dismiss/snooze persistence for slot prompts
- Custom date/time picker UI
- GCal export/mirror
- LLM parsing or generation
- Telegram/Web Push slot prompts
- New DB tables or migrations

## 입력/출력 명세

- Extend `GET /api/today?date=YYYY-MM-DD&now=<ISO datetime>`
  - Add `unscheduledEvents: EventRow[]`.
  - Add card union `{ kind: "schedule_prompt", event: EventRow }`.
  - Candidate event rules:
    - `events.source='cairn'`
    - `events.self_imposed=1`
    - `events.start IS NULL`
    - `events.end IS NULL`
    - `events.status='planned'`
  - Sort by oldest `id` first.
  - Limit Today schedule prompts to 3.
  - Fixed card priority becomes:
    - conflicts
    - watchers
    - next event
    - two-minute tasks
    - needs-review
    - schedule prompts

- Add `GET /api/events/:id/slot-candidates?date=YYYY-MM-DD&now=<ISO datetime>&days=<1..14>`
  - Event id must be positive and exist.
  - Event must be an unscheduled Cairn self-imposed planned event.
  - `days` defaults to `7`.
  - Return `{ ok: true, data: { event, candidates } }`.
  - Candidate shape:
    - `{ start: string, end: string, reasons: string[], reasonCodes: string[] }`
  - Generate candidate starts in the offset of `now`; no named timezone
    normalization in Cycle 13.
  - Deterministic window starts per day:
    - `09:00`, `11:00`, `14:00`, `16:00`, `19:00`
  - Candidate duration defaults to 60 minutes.
  - Exclude candidates that start at or before `now`.
  - Exclude candidates that overlap any non-cancelled event with both
    `start` and `end`.
  - Return up to 3 earliest conflict-free candidates.
  - If none exist, return an empty candidate array, not an error.

- Add `PATCH /api/events/:id/schedule`
  - Body: `{ "start": string, "end": string }`.
  - Both values must be RFC3339 datetimes with offset.
  - `end` must be after `start`.
  - Event id must be positive and exist.
  - Event must be an unscheduled Cairn self-imposed planned event.
  - Reject stale/conflicting selections with `409 CONFLICT`.
  - On success update only `events.start` and `events.end`.
  - Return `{ ok: true, data: { event } }`.
  - Failures:
    - `400 VALIDATION_ERROR`
    - `404 NOT_FOUND`
    - `409 CONFLICT`

- Today frontend
  - Render `schedule_prompt` cards in live stack.
  - Card copy: compact "날짜 잡을까?" prompt for the event title.
  - Button loads slot candidates from the new candidates API.
  - Show loading, empty-candidate, candidate-list, and local error states.
  - Candidate tap calls `PATCH /api/events/:id/schedule`, then refetches Today.
  - On failure, keep the card visible and show local error.
  - No freeform date/time input in Cycle 13.

## Key Changes

- Shared:
  - Add slot candidate schemas/types.
  - Extend Today surface schema with `unscheduledEvents` and
    `schedule_prompt`.
  - Add event schedule request/response schemas.
- Backend:
  - Add repository helpers for unscheduled Cairn events and schedule updates.
  - Add deterministic slot candidate service.
  - Add route handlers for slot candidates and schedule assignment.
  - Extend Today aggregation with schedule prompts.
  - Keep candidate generation and Today aggregation deterministic.
- Frontend:
  - Add schedule prompt card UI to `/today`.
  - Fetch candidates on demand.
  - Apply selected candidate and refetch Today.
  - Preserve existing quick capture, manual intake, timeline, review, and
    thread-picker behavior.
- Docs:
  - Update `docs/codebase-map.md` with slot candidate route/service/UI paths.

## Sprint Contract

- 통과 기준:
  - Today includes unscheduled Cairn planned events in `unscheduledEvents`.
  - Today excludes GCal events, already scheduled events, and non-planned
    statuses from schedule prompts.
  - Today card priority places schedule prompts after needs-review.
  - Slot candidate API returns up to 3 earliest conflict-free 60-minute slots.
  - Candidate generation skips candidates that overlap existing
    non-cancelled events.
  - Candidate generation skips candidates at or before `now`.
  - Candidate API returns empty candidates when no conflict-free slot exists.
  - Schedule PATCH updates `start` and `end` only after validation.
  - Schedule PATCH rejects missing, external, already scheduled, invalid, and
    conflicting events with typed errors.
  - `/today` UI renders schedule prompt card and can load candidates.
  - Candidate selection calls PATCH, then refetches Today.
  - Failed candidate fetch or schedule PATCH keeps card visible and shows
    local error.
  - No LLM gateway import in Today or slot services/routes.
  - No DB migration is added.
  - `docs/codebase-map.md` is updated.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- 테스트 케이스:
  - Backend integration: unscheduled Cairn planned event appears as
    `schedule_prompt`.
  - Backend integration: GCal unscheduled event is excluded.
  - Backend integration: scheduled event is excluded.
  - Backend integration: done/cancelled/moved/late events are excluded.
  - Backend integration: prompts limited to 3 and sorted oldest id first.
  - Backend integration: candidate list skips overlaps.
  - Backend integration: candidate list skips past/now slots.
  - Backend integration: candidate list empty when all windows conflict.
  - Backend integration: schedule PATCH updates start/end.
  - Backend integration: schedule PATCH rejects conflicting stale selection.
  - Backend integration: deterministic `/api/today` and slot routes work
    without LLM proxy.
  - Frontend test: `/today` renders schedule prompt card.
  - Frontend test: clicking "날짜 잡기" loads candidates.
  - Frontend test: candidate selection patches schedule and refetches Today.
  - Frontend test: failed candidate fetch or schedule PATCH shows error and
    keeps prompt visible.
  - Frontend regression: quick capture still works.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Candidate window crosses midnight because of offset math; Cycle 13 should
  avoid this with fixed same-day windows and 60-minute duration.
- Existing event has invalid stored datetime despite schema intent; candidate
  service should ignore only unparsable rows or treat them conservatively,
  but must not crash `/today`.
- User opens candidates, another process schedules a conflicting event, then
  user selects stale candidate; PATCH must re-check conflict and return
  `409 CONFLICT`.

## 더 단순한 대안 1개

Add a manual date/time picker for unscheduled events and skip candidate
generation. This is simpler, but it misses the core `FR-SLOT` promise:
Cairn should offer low-friction candidate slots with reasons instead of making
the user invent a time from scratch.

## Assumptions

- Cycle 13 priority is the first deterministic slot-suggestion loop.
- Only unscheduled `events` are handled; task scheduling waits for a later
  cycle.
- `events.start` and `events.end` are already nullable, so no migration is
  expected.
- Default candidate duration is 60 minutes.
- Candidate timestamps use the offset from the `now` query parameter.
- Date matching remains literal `YYYY-MM-DD` prefix where day filtering is
  needed.
- No user decision is mutated until `PATCH /api/events/:id/schedule`.
- Candidate reasons are deterministic strings, not LLM output.

## Review Guidance

### Enumeration 필요 항목

- Slot route/service surface:
  - Search: `rg -n "slot-candidates|schedule_prompt|schedule.*event|SlotCandidate" shared/src server/src web/src`
  - Expected: shared schemas, server route/service/repository helpers, web
    Today UI/tests.
- Today deterministic boundary:
  - Search: `rg -n "from .*llm|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src/routes/today.ts server/src/services/today.ts server/src/routes server/src/services`
  - Expected: no Today or slot route/service LLM dependency.
- Schedule mutation scope:
  - Search: `rg -n "PATCH /api/events/:id/schedule|scheduleEvent|start|end" server/src/routes server/src/services server/src/repositories`
  - Expected: schedule PATCH updates only `events.start` and `events.end`.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.
- Codebase map:
  - Search: `rg -n "slot-candidates|schedule_prompt|Slot Suggestion" docs/codebase-map.md`
  - Expected: map documents new route/service/UI entry points.

### 검증 방식 가이드

- Candidate generation, conflict rejection, and schedule update require real
  temporary SQLite integration tests.
- UI candidate loading and apply behavior can use Vitest component tests with
  mocked fetch.
- Mock-only tests are insufficient for conflict detection because stored event
  overlap behavior must be proven against repository queries.
- Reviewer should treat any task scheduling, people preference, friction
  weighting, LLM call, or migration as scope creep.
