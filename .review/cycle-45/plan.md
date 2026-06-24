# Preparation Brief A Implementation Plan

Branch: feature/cycle-45-preparation-brief-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 45 implements the first deterministic slice of `FR-BRF-04` after cycle
44's schedule brief foundation. It extends event detail `scheduleBrief` with a
read-only preparation list built from existing `resources` and `resource_links`.

This is the automatic layer only. It surfaces already-known items/knowledge
linked to the event, the event's thread, or the nearest prior same-thread event.
It does not add AI preparation suggestions, manual one-line preparation entry,
procurement fields, vendors/venues, movement options, route planning, or new
resource creation from the event detail sheet.

## 입력/출력 명세
- 입력:
  - Existing `GET /api/events/:id`.
  - Existing `resources` and `resource_links`.
  - Existing cycle-44 event context: event, thread, previous same-thread event.
- 출력:
  - 정상:
    - Extend `scheduleBrief` with `preparations: ScheduleBriefPreparation[]`.
    - Proposed preparation shape:
      - `resource`: existing `ResourceRow`.
      - `sourcePerson`: `{ id, name } | null`.
      - `links`: relevant links only, each with:
        - `targetType`: `event | thread`
        - `targetId`: number
        - `scope`: `event_direct | thread_context | previous_event`
        - `firmness`: existing resource link firmness
        - `reason`: existing resource link reason or `null`
      - `reasonCodes: string[]`
    - Relevant links for a target event:
      - direct resource links to the event;
      - resource links to the event's thread, when `threadId` exists;
      - resource links to the nearest prior same-thread event selected by
        cycle-44 logic, when it exists.
    - Deduplicate by resource id and group multiple relevant links under one
      preparation row.
    - Sort deterministically: item before knowledge, resource name asc, resource
      id asc. Links sort by scope order `event_direct`, `thread_context`,
      `previous_event`, then target id asc.
    - Event detail sheet renders a compact "준비" section only when
      preparations exist:
      - `item`: "준비물"
      - `knowledge`: "참고"
      - show firmness/reason/source-person when present.
  - 실패:
    - No linked resources yields `preparations: []` and no UI section.
    - Missing thread or prior event yields no guessed thread/prior resources.
    - Missing/deleted source person yields `sourcePerson=null`.
    - GET detail remains read-only.

## Key Changes
- Shared:
  - Extend `shared/src/eventDetail.ts` with
    `ScheduleBriefPreparationLinkSchema`,
    `ScheduleBriefPreparationSchema`, and required
    `ScheduleBriefSchema.preparations`.
  - Reuse `ResourceRowSchema`, `ResourceFirmnessSchema`, and target-type enums
    from `shared/src/resources.ts`.
  - Keep schemas strict; reject injected suggestion/action/procurement/movement
    fields.
- Backend:
  - Add a pure deterministic preparation brief builder, likely in
    `server/src/services/preparationBrief.ts` or as a small helper next to
    `scheduleBrief.ts`.
  - Add repository read(s) in `server/src/repositories/resources.ts` for
    resource links by explicit targets:
    - `{ targetType: "event", targetId: event.id }`
    - `{ targetType: "thread", targetId: event.threadId }`
    - `{ targetType: "event", targetId: previousEvent.id }`
  - Include resource rows and source-person names in the read model.
  - Wire `GET /api/events/:id` to pass the already-selected previous event into
    the preparation builder.
  - Do not add writes, LLM calls, external API calls, map providers,
    procurement columns, contact generalization, or resource promotion approval.
  - Update `docs/codebase-map.md`.
- Frontend:
  - Update `web/src/Today.tsx` event detail sheet to render preparation facts
    inside the existing schedule brief section or a compact adjacent subsection.
  - Keep quiet behavior: no preparations means no new section.
  - Use semantic tokens only; no new tab/page/nav.

## Sprint Contract
- 통과 기준:
  - `EventDetailDataSchema` requires `scheduleBrief.preparations`.
  - `GET /api/events/:id` returns `preparations: []` for events with no relevant
    resource links.
  - Direct event resource links appear with scope `event_direct`.
  - Thread resource links appear with scope `thread_context` when the event has
    a thread.
  - Nearest prior same-thread event resource links appear with scope
    `previous_event` when the prior event exists.
  - Resources are deduped and grouped by resource id when multiple scopes match.
  - Sorting is deterministic.
  - Source-person is included when known and `null` when absent.
  - Event detail UI renders item/knowledge preparation rows and hides the
    preparation section when empty.
  - Read path does not mutate events, annotations, resources, resource_links,
    people, or params.
  - No AI preparation suggestion, manual preparation editor, procurement field,
    vendor/venue/contact generalization, movement option, route planner, LLM
    call, or external API call is introduced.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static no write/external in new preparation diff:
    `git diff -U0 master..HEAD -- server/src/services/preparationBrief.ts server/src/repositories/resources.ts server/src/routes/events.ts | rg -n "\\b(insert|update|delete|transaction|onConflict|run\\(|fetch\\(|completeChat|LLM_PROXY_BASE_URL|naver|odsay|kakao|maps)\\b"`
  - Static no section-11 scope creep:
    `rg -n "procurement|proc_|vendor|venue|domain|travelOption|routeOption|manualPreparation|aiSuggestion|star_|resume" shared/src/eventDetail.ts server/src/routes/events.ts server/src/repositories/resources.ts web/src/Today.tsx`
- 테스트 케이스:
  - Shared unit:
    - `ScheduleBriefSchema` requires `preparations`.
    - Empty preparations are valid.
    - Full preparation item with source person and multiple links is valid.
    - Injected `recommendation`, `autoAction`, `procurement`, `travelOption`,
      or `manualEntry` fields are rejected.
  - Pure service unit:
    - Groups multiple relevant links under one resource.
    - Sorts item before knowledge, name asc, id asc.
    - Sorts links by scope order and target id.
    - Missing source person remains `null`.
    - Unknown/unrelated target links are ignored.
  - Backend integration:
    - `GET /api/events/:id` returns no preparations when none are linked.
    - Direct event resource appears as `event_direct`.
    - Thread-level resource appears as `thread_context`.
    - Previous same-thread event resource appears as `previous_event`.
    - Duplicate resource across direct/thread/prior is grouped once.
    - Row counts for events, annotations, resources, resource_links, people,
      and params do not change on GET.
  - Frontend:
    - Event detail renders preparation rows with item/knowledge labels.
    - Source person, firmness, and reason render when present.
    - Empty preparations render no preparation section.
    - Existing event detail loading/error/live, note submit, status patch, close,
      and schedule brief behavior remain covered.
  - 수동:
    - Mobile Chrome light/dark: preparation rows readable.
    - Keyboard: preparation section adds no focusable controls.
    - Reduced motion: preparation meaning does not depend on motion.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- A resource is linked directly to the target event and also to its thread;
  it must show once with two scoped links, not duplicate rows.
- Target event has no thread or no start; prior/thread scopes must stay empty
  rather than falling back to broad thread resource focus.
- A previous event has a linked resource with `firmness="tentative"` and a
  direct target link has `firmness="hard"`; the UI must preserve per-link
  firmness instead of promoting the whole resource to hard.

## 더 단순한 대안 1개
Use existing `GET /api/threads/:id/resource-focus` and dump all thread resources
into the event sheet. This is faster, but too noisy for a preparation brief: it
would include resources linked to unrelated thread tasks/events and violate the
"automatic highlight, not management burden" intent.

## Assumptions
- Existing resource links are already user-approved enough to display as
  facts. This cycle does not infer new resources from event text.
- `item` resources map to "준비물" and `knowledge` resources map to "참고" in UI.
- Prior-event scope reuses cycle-44's nearest prior same-thread event selection.
- Manual one-line preparation creation and AI "발표면 노트북?" suggestions remain
  future slices.

## Review Guidance
### Enumeration 필요 항목
- Schedule brief contract:
  - Search:
    `rg -n "ScheduleBriefPreparation|preparations|event_direct|thread_context|previous_event" shared/src/eventDetail.ts server/src web/src/Today.tsx`
  - Expected: shared schema, backend builder/repository wiring, route response,
    and UI all agree on required `preparations`.
- Resource read path:
  - Search:
    `rg -n "resourceLinks|resources|sourcePerson|preparation" server/src/repositories/resources.ts server/src/services server/src/routes/events.ts`
  - Expected: only explicit event/thread/prior targets are read; no broad
    thread resource-focus dump.
- No write/external/scope creep:
  - Search static commands from Sprint Contract.
  - Expected: no writes in GET detail preparation path, no LLM/external/map
    calls, and no procurement/contact/domain/manual-AI scope.
- UI behavior:
  - Search:
    `rg -n "preparation|준비|참고|ScheduleBriefSection|event-detail" web/src/Today.tsx web/src/Today.test.tsx web/src/styles.css`
  - Expected: preparation section is display-only, semantic-token styled, and
    hidden when empty.

### 검증 방식 가이드
- Shared schema changes: unit tests sufficient.
- Group/sort/scope logic: pure service unit tests required.
- SQLite/repository route wiring and read-only guarantee: integration tests
  against a real temporary SQLite database required.
- UI rendering and non-interactive behavior: Vitest + Testing Library
  sufficient; manual mobile/light/dark/reduced-motion evidence may be recorded
  in review if physical checks are unavailable.
