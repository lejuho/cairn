# Schedule Brief A Implementation Plan

Branch: feature/cycle-44-schedule-brief-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 44 opens `docs/cairn-spec.md` section 11 with a small, non-invasive
Schedule Brief A slice. It adds an optional event `mode`
(`in_person | remote | async`) and surfaces a compact event brief from data
Cairn already owns: thread context, nearby prior annotation, and attached
people profiles.

This cycle is not Movement, Procurement, Contacts, or Domain work. It must not
call map APIs, add route planning, add procurement fields, generalize people
into vendors/venues, or infer private context with an LLM. The brief is a
read-only highlight layer plus an optional tap-based mode input for newly
created events.

## 입력/출력 명세
- 입력:
  - Existing `POST /api/events` body, extended with optional
    `mode: "in_person" | "remote" | "async"`.
  - Existing `GET /api/events/:id`.
  - Existing event/thread/people/annotation rows.
- 출력:
  - 정상:
    - `EventRow` includes `mode: EventMode | null`.
    - `GET /api/events/:id` includes a `scheduleBrief` object:
      - `mode`: event mode or `null`.
      - `thread`: compact thread context with id/name and nullable goal/deadline.
      - `previousEvent`: nearest same-thread event that ended before this event
        starts, or `null`.
      - `previousAnnotation`: newest annotation attached to that previous event,
        or `null`.
      - `people`: attached people with existing authored profile fields
        surfaced as factual brief items.
      - `reasonCodes: string[]` explaining which facts were available.
    - Today event-bearing cards and the event detail sheet display mode when
      present:
      - `in_person`: "대면"
      - `remote`: "비대면"
      - `async`: "과제"
    - Event detail sheet shows an automatic context brief when thread, previous
      annotation, or people profile facts exist.
    - Input Hub offers optional tap chips for event mode; unspecified stays
      `null`.
  - 실패:
    - Invalid `mode` is rejected with existing `400 VALIDATION_ERROR`.
    - Existing rows with `mode=null` remain valid and display no fabricated mode.
    - Missing thread, malformed prior dates, or missing annotations yield null /
      omitted brief facts, not guessed values.
    - Remote/async events do not trigger any movement/location option.

## Key Changes
- Shared:
  - Add `EventModeSchema` and `EventMode` in `shared/src/events.ts`.
  - Extend `CreateEventRequestSchema` with optional `mode`.
  - Extend `EventRowSchema` with `mode: EventMode | null`.
  - Add `ScheduleBriefSchema` to `shared/src/eventDetail.ts` and extend
    `EventDetailDataSchema` with `scheduleBrief`.
  - Keep injected Movement/Procurement/Contact/Domain fields out of this
    cycle's accepted schemas.
- Backend:
  - Add nullable `events.mode` in `server/src/db/schema.ts` with a CHECK for
    `in_person`, `remote`, `async`, or null.
  - Generate and commit the Drizzle migration.
  - Update event creation repositories so optional mode persists for new Cairn
    events; flat/raw capture and GCal/imported events stay `null`.
  - Add a pure deterministic brief builder, likely
    `server/src/services/scheduleBrief.ts`.
  - Add repository reads needed by the brief:
    - full compact thread context for an event thread;
    - nearest prior same-thread event by end time;
    - newest annotation for that prior event;
    - existing full people profiles already loaded for event detail.
  - Extend `GET /api/events/:id` to return `scheduleBrief`.
  - Do not add LLM calls, external API calls, map providers, DB writes on read,
    or movement/procurement/domain/contact fields.
  - Update `docs/codebase-map.md`.
- Frontend:
  - Update `web/src/InputHub.tsx` event form with optional mode chips.
  - Update `web/src/Today.tsx` event card/detail rendering:
    - show mode chip only when present;
    - show schedule brief in the event detail sheet;
    - keep existing note/status/people interactions unchanged.
  - Use semantic design tokens only; no new primary tab/page.

## Sprint Contract
- 통과 기준:
  - SQLite accepts legacy events with `mode=null`.
  - SQLite rejects mode values outside `in_person | remote | async`.
  - `POST /api/events` persists valid optional mode and rejects invalid mode.
  - Event creation without mode remains backward compatible.
  - `EventRowSchema` and `EventDetailDataSchema` require the new fields.
  - `GET /api/events/:id` returns `scheduleBrief` for events with and without
    thread/people/annotation context.
  - Prior annotation selection is deterministic and only uses same-thread
    events that ended before the target event starts.
  - People brief displays existing authored profile facts only; no inferred
    sensitivities or advice.
  - Today cards and event detail display mode copy when mode is present and
    stay quiet when mode is null.
  - Input Hub mode selection is optional tap input; it does not make mode a
    required form field.
  - No route planner, map provider, movement option, procurement field,
    contact/vendor/venue generalization, domain filter, LLM call, or external
    API call is introduced.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static no movement/provider scope:
    `rg -n "naver|odsay|kakao|maps|travelOption|routeOption|completeChat|LLM_PROXY_BASE_URL|fetch\\(" server/src/services/scheduleBrief.ts server/src/routes/events.ts`
  - Static no section-11 scope creep:
    `rg -n "procurement|proc_|vendor|venue|domain|resume|star_" shared/src/events.ts shared/src/eventDetail.ts server/src/db/schema.ts server/src/routes/events.ts web/src/Today.tsx web/src/InputHub.tsx`
- 테스트 케이스:
  - Shared unit:
    - `EventModeSchema` accepts all three modes and rejects unknown strings.
    - `CreateEventRequestSchema` accepts missing mode and valid mode.
    - `EventRowSchema` requires `mode`.
    - `EventDetailDataSchema` requires `scheduleBrief`.
    - Injected movement/procurement/domain fields are rejected where this
      cycle makes schemas strict.
  - Pure service unit:
    - null mode produces a quiet brief.
    - same-thread prior event + annotation produces previous context.
    - future/later same-thread events are ignored.
    - missing thread/person/annotation data produces null or empty facts.
    - people profile facts are factual and reason-coded, not advice.
  - Backend integration:
    - migration creates nullable `events.mode` with enum CHECK.
    - `POST /api/events` persists `mode`.
    - invalid mode returns `400 VALIDATION_ERROR` and writes nothing.
    - `GET /api/events/:id` returns schedule brief with thread, people, and
      previous annotation context.
    - `GET /api/events/:id` remains read-only by row-count checks.
  - Frontend:
    - Input Hub posts selected mode and omits mode when unspecified.
    - Today/event detail renders each mode copy.
    - Null mode renders no fabricated label.
    - Event detail schedule brief displays thread, previous annotation, and
      people profile facts when present.
    - Existing note submit, status patch, sheet close, loading, quiet, live,
      error, and access-session states remain covered.
  - 수동:
    - Mobile Chrome light/dark: mode chip and brief copy readable.
    - Keyboard: optional mode chips and event detail sheet focus order sane.
    - Reduced motion: brief meaning does not depend on animation.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- Target event has no `start`; previous-context lookup must not guess ordering
  from creation time.
- Multiple same-thread prior events end at the same timestamp; tie-break by
  end desc, then id desc for deterministic selection.
- Attached person has malformed profile JSON in DB; brief should fail open and
  omit that profile fact instead of breaking the detail sheet.

## 더 단순한 대안 1개
Only add event `mode` and show a chip. This is simpler, but it does not satisfy
FR-BRF-02/03 because the event sheet would still fail to highlight the context
and people facts Cairn already has.

## Assumptions
- `mode=null` means unknown, not remote or async.
- Existing `people` profile fields are authored/hard enough to display as
  facts; this cycle does not infer new sensitivities.
- "직전 annotation" is interpreted for A-slice as the newest annotation on the
  nearest prior same-thread event that ended before the target event starts.
- GCal inbound events will default to `mode=null` until a later explicit edit or
  inference cycle.

## Review Guidance
### Enumeration 필요 항목
- Event mode contract:
  - Search:
    `rg -n "EventMode|scheduleBrief|eventMode|modeChip|brief-mode|in_person|remote|async" shared/src/events.ts shared/src/eventDetail.ts server/src/db/schema.ts server/src/repositories/events.ts server/src/routes/events.ts web/src/Today.tsx web/src/InputHub.tsx`
  - Expected: mode exists in DB schema, shared schemas, create/persist path, and
    display path. It must stay nullable for legacy rows.
- Event detail response:
  - Search:
    `rg -n "EventDetailData|scheduleBrief|GET /api/events/:id|findEventWithPeople|findAnnotationsByEvent" shared/src/eventDetail.ts server/src/routes/events.ts server/src/repositories web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: every event detail fixture/schema includes `scheduleBrief`.
- Brief data source:
  - Search:
    `rg -n "previousEvent|previousAnnotation|ScheduleBrief|scheduleBrief" server/src shared/src web/src`
  - Expected: deterministic same-thread prior context only; no LLM/external
    calls and no unrelated graph traversal.
- Scope creep:
  - Search static commands from Sprint Contract.
  - Expected: no Movement API/provider, Procurement, Contacts generalization,
    Domain feature, STAR/resume, LLM, or external fetch in this cycle.

### 검증 방식 가이드
- Shared schema changes: unit tests sufficient.
- SQLite nullable enum and route persistence: integration tests against a real
  temporary SQLite database required.
- Prior-context selection: pure service unit tests required; route integration
  should prove the repository wiring.
- Read-only detail behavior: integration row-count checks required.
- UI chip/brief rendering and existing event sheet behavior: Vitest + Testing
  Library sufficient.
- Mobile/light/dark/reduced-motion checks remain manual unless headless/code
  evidence is explicitly recorded in the review.
