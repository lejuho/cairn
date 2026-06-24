# Preparation Suggestions A Implementation Plan

Branch: feature/cycle-47-preparation-suggestions-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 47 implements the next `FR-BRF-04` layer after cycle 45 automatic
preparation facts and cycle 46 manual one-line entry: a conservative
preparation suggestion surface inside the event detail sheet.

The spec names this layer "AI suggestion" and still marks the trigger as open.
This cycle intentionally implements the first deterministic trigger/confirmation
slice only. It suggests a small set of likely `item` preparations from event and
thread keywords, shows a reason, and requires an explicit user tap before any
resource is created. It does not add an LLM call, external API, procurement,
movement, contacts, or domain-feed behavior.

## 입력/출력 명세
- 입력:
  - Existing `GET /api/events/:id`.
  - Existing event detail data already loaded by the route:
    - event title and mode;
    - compact thread name/goal when present;
    - already visible `scheduleBrief.preparations`.
  - Existing `POST /api/events/:id/preparations` remains the only write used by
    the UI when a suggestion is accepted.
- 출력:
  - 정상:
    - `GET /api/events/:id` extends `scheduleBrief` with
      `preparationSuggestions: ScheduleBriefPreparationSuggestion[]`.
    - Suggestion shape:
      - `key: string` stable within the current event detail response.
      - `name: string` item name to add if accepted.
      - `kind: "item"`.
      - `source: "deterministic_keyword"`.
      - `reasonCode: "presentation_keyword"`.
      - `reason: string` human-readable explanation for why the item is shown.
      - `evidence: { field: "event_title" | "thread_name" | "thread_goal"; value: string }`.
    - Trigger table for this A-slice:
      - If event title, thread name, or thread goal contains a presentation/demo
        keyword (`발표`, `프레젠테이션`, `presentation`, `demo`, `데모`, `강의`,
        `세미나`), suggest exactly `노트북`, `충전기`, `어댑터`.
    - Suggestions are deduplicated in deterministic order and filtered out when
      the same item name is already present in visible preparations.
    - `scheduleBrief.reasonCodes` includes `brief_preparation_suggestions` when
      at least one suggestion is returned.
    - UI renders suggestions as tap-first chips/buttons with their reason.
      Accepting one calls the existing manual preparation POST, then refetches
      event detail so the accepted item moves into the "준비" list.
    - `GET` is read-only: no resource, link, annotation, task, or event writes.
  - 실패:
    - Invalid event id and missing event keep the existing route behavior.
    - Missing optional source fields simply produce `preparationSuggestions: []`;
      unexpected route/service errors keep the existing server error behavior.
    - Failed suggestion acceptance shows a sheet-local error and does not remove
      the suggestion or close the sheet.

## Key Changes
- Shared:
  - Extend `shared/src/eventDetail.ts` with strict
    `ScheduleBriefPreparationSuggestionSchema` and add
    `preparationSuggestions` to `ScheduleBriefSchema`.
  - Add schema tests for valid suggestions, required field, strict rejection of
    injected score/action/write fields, and quiet empty arrays.
- Backend:
  - Add a pure deterministic suggestion helper, likely
    `server/src/services/preparationSuggestions.ts`.
  - Update `GET /api/events/:id` assembly to compute suggestions from already
    loaded event/thread/preparation data and pass them into `scheduleBrief`.
  - Keep repositories and DB schema unchanged; no migration.
  - Add focused unit tests for trigger matching, unknown-keyword quiet behavior,
    duplicate suppression, stable ordering, and evidence field choice.
  - Add route integration tests proving `GET /api/events/:id` returns
    suggestions for the presentation trigger and does not write DB rows.
  - Update `docs/codebase-map.md`.
- Frontend:
  - Update `web/src/Today.tsx` event detail rendering to show a compact
    "준비물 제안" area when `scheduleBrief.preparationSuggestions` is non-empty.
  - Reuse the existing page-level `addEventPreparation(eventId, name)` flow for
    acceptance; no reusable visual component may perform network writes itself.
  - On accept success, refetch detail and rely on duplicate filtering to remove
    the accepted suggestion.
  - On accept failure, show a scoped `role="alert"` error near the suggestions.
  - Style chips/buttons with semantic tokens, at least 44px touch targets, and
    no meaning that depends on animation.

## Sprint Contract
- 통과 기준:
  - `ScheduleBriefSchema` requires `preparationSuggestions` and keeps the new
    suggestion objects strict.
  - Presentation/demo keywords in event title, thread name, or thread goal
    produce the fixed item suggestions `노트북`, `충전기`, `어댑터`.
  - Events and threads without trigger keywords return an empty suggestion list.
  - Suggestions are deterministic and stable across repeated reads.
  - `scheduleBrief.reasonCodes` contains `brief_preparation_suggestions` only
    when suggestions are non-empty.
  - Any item already present in visible `scheduleBrief.preparations` is not
    suggested again.
  - `GET /api/events/:id` with suggestions leaves row counts unchanged for
    resources, resource links, events, tasks, and annotations.
  - Event detail UI renders suggestions only when present, shows a reason, and
    performs no POST on initial render.
  - Accepting a suggestion calls the existing
    `POST /api/events/:id/preparations` with `{ name }`, refetches detail on
    success, and handles duplicate success as success.
  - Failed acceptance keeps the sheet usable, keeps the suggestion visible, and
    reports a local error.
  - No LLM gateway call, external API call, map/route adapter, procurement or
    rental field, contact generalization, domain feed, or automatic mutation is
    introduced.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static no LLM/external/map in implementation diff:
    `git diff -U0 master..HEAD -- shared/src server/src web/src | rg -n "\\b(completeChat|LLM_PROXY_BASE_URL|naver|odsay|kakao|maps|http://|https://)\\b"`
  - Static no GET write in suggestion assembly diff:
    `git diff -U0 master..HEAD -- server/src/services/preparationSuggestions.ts server/src/routes/events.ts | rg -n "\\b(insert|update|delete|transaction|onConflict|run\\()\\b"`
  - Static no out-of-scope section-11 fields in non-test implementation diff:
    `git diff -U0 master..HEAD -- shared/src server/src web/src ':!**/*.test.ts' ':!**/*.test.tsx' | rg -n "procurement|proc_|vendor|venue|domain|travelOption|routeOption|manualKnowledge|rental"`
- 테스트 케이스:
  - Shared unit:
    - schedule brief requires `preparationSuggestions`.
    - empty suggestion array is valid.
    - valid deterministic suggestion is accepted.
    - injected score/action/write fields are rejected.
  - Backend unit:
    - event-title trigger returns the three fixed items with reasons.
    - thread-name and thread-goal triggers work without duplicating items.
    - unknown keywords return `[]`.
    - existing visible preparations suppress same-name suggestions.
    - output order is stable.
  - Backend integration:
    - GET detail returns suggestions for a matching event.
    - GET detail returns no suggestions for a non-matching event.
    - GET detail with suggestions leaves DB row counts unchanged.
    - GET detail after accepting a suggestion no longer returns that item as a
      suggestion and includes it in `scheduleBrief.preparations`.
  - Frontend:
    - event detail renders "준비물 제안" only when suggestions exist.
    - suggestion buttons show item name and reason.
    - initial render performs no preparation POST.
    - accepting a suggestion posts `{ name }`, refetches, and clears any prior
      suggestion error.
    - failed acceptance shows a local alert and keeps the suggestion visible.
    - existing event detail loading/error/live, manual add, note submit, status
      patch, close, and schedule brief behavior remain covered.
  - 수동:
    - Mobile Chrome light/dark: suggestion chips and accepted preparation row
      are readable.
    - Keyboard: suggestion buttons, manual input, submit, and close are
      reachable in sane order.
    - Reduced motion: suggestion/acceptance meaning does not depend on motion.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- A presentation event already has `노트북` linked from the thread but not
  directly to the event; this cycle should hide the duplicate suggestion because
  the item is already visible in the brief.
- Multiple trigger fields match different keywords; the fixed item list should
  appear once with deterministic evidence selection.
- User accepts a suggestion but the detail refetch fails; the UI should show the
  scoped refetch/error state without firing a second POST automatically.

## 더 단순한 대안 1개
Render hard-coded frontend suggestions based only on the event title. This is
faster, but it would duplicate product logic in the client, cannot be shared by
future push or notification surfaces, and is harder to test for no-write
behavior. The chosen backend helper keeps the suggestion contract server-owned
and deterministic.

## Assumptions
- The first trigger family is intentionally narrow: presentation/demo/lecture
  keywords only. Other event types remain future work after the trigger design
  is validated.
- Suggestion matching uses normalized whitespace and case-insensitive comparison
  for Latin text; Korean text is matched as written.
- Accepted suggestions are stored through the existing manual preparation route.
  This cycle does not persist suggestion provenance or a separate approval
  reason.
- The existing `resources` and `resource_links` schema is sufficient; no
  migration is needed.

## Review Guidance
### Enumeration 필요 항목
- Shared schedule brief contract:
  - Search:
    `rg -n "ScheduleBriefPreparationSuggestion|preparationSuggestions|ScheduleBriefSchema" shared/src`
  - Expected: schema, type export, tests, and all schedule brief fixtures include
    required `preparationSuggestions`.
- Backend suggestion path:
  - Search:
    `rg -n "preparationSuggestions|buildPreparationSuggestions|presentation_keyword|deterministic_keyword" server/src shared/src`
  - Expected: one pure service computes suggestions; event detail route only
    passes already-loaded data; no repository write or external dependency.
- UI suggestion surface:
  - Search:
    `rg -n "준비물 제안|prep-suggestion|preparationSuggestions|addEventPreparation" web/src/Today.tsx web/src/Today.test.tsx web/src/styles.css`
  - Expected: suggestions render in the detail sheet, acceptance reuses the
    existing page-level POST helper, and failures are scoped.
- Scope creep:
  - Run the static commands from Sprint Contract.
  - Expected: no LLM/external/map calls, no GET writes, and no procurement/
    contact/domain/movement fields.

### 검증 방식 가이드
- Shared schemas: unit tests sufficient.
- Pure trigger matching and duplicate suppression: backend unit tests
  sufficient.
- GET read-only behavior and accepted-suggestion visibility: integration tests
  against a real temporary SQLite database required.
- UI rendering and accept/failure flow: Vitest + Testing Library sufficient.
- Manual mobile/light/dark/reduced-motion evidence may be recorded in review if
  physical checks are unavailable; otherwise record direct device evidence in
  the latest review.
