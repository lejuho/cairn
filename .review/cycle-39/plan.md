# Resource Promotion Suggestions A Implementation Plan

Branch: feature/cycle-39-resource-promotion-suggestions-a
Skills: backend-fastify, frontend-react-pwa

## Summary
Cycle 38 added the durable resource/link model and thread resource-focus UI.
This cycle implements the first A-slice of FR-XREL-01: detect repeated explicit
resource mentions, show "묶을까?" suggestions, and only create `resources` plus
`resource_links` after user approval.

The slice is intentionally conservative. It does not attempt Korean noun
extraction or LLM inference. Candidate detection is deterministic and only uses
explicit lightweight labels already present in free text, so no relation is
created from a guess.

## 입력/출력 명세
- 입력:
  - `GET /api/resources/promotion-suggestions?threadId=<positive int>`
    - `threadId` is optional. When supplied, suggestions are scoped to that
      thread spine: the thread itself, its events, and its tasks.
    - Candidate source fields:
      - `threads.name`, `threads.goal`
      - `events.title`, `events.location`
      - `tasks.title`, `tasks.context`
    - Recognized explicit mention forms:
      - `준비물: <name>` / `item: <name>` -> `kind="item"`
      - `지식: <name>` / `knowledge: <name>` -> `kind="knowledge"`
      - Mention capture stops at comma, newline, semicolon, or sentence end.
      - Names are trimmed, whitespace-collapsed, max 120 chars, and empty names
        are ignored.
  - `POST /api/resources/promotion-suggestions/approve`
    - Body: `{ candidateKey, name, kind, occurrences, sourcePersonId?, note? }`
    - `occurrences`: array of `{ targetType: "event"|"task"|"thread", targetId: number }`
    - Server recomputes the current suggestion set before mutation and rejects
      stale or ineligible candidates.
- 출력:
  - 정상:
    - GET returns `{ ok: true, data: { suggestions } }`.
    - Each suggestion includes `{ candidateKey, name, kind, occurrenceCount,
      occurrences, existingResourceId? }`.
    - POST returns `{ ok: true, data: { resource, links, reusedResource } }`.
    - Approval transaction:
      - reuses an existing exact same-name/same-kind resource when present;
        otherwise creates one;
      - creates idempotent `resource_links` for each occurrence with
        `firmness="tentative"` and a reason that includes the repeated mention
        source;
      - never auto-selects or auto-confirms a suggestion in the UI.
  - 실패:
    - `400 VALIDATION_ERROR` for malformed query/body or invalid occurrence set.
    - `404 SOURCE_PERSON_NOT_FOUND` for missing optional source person.
    - `409 PROMOTION_STALE` when candidateKey/name/kind/occurrences no longer
      match the recomputed deterministic suggestion.
    - `409 PROMOTION_NOT_ELIGIBLE` when fewer than two distinct target nodes
      remain.

## Key Changes
- Shared:
  - Add resource promotion schemas/types in `shared/src/resources.ts`.
  - Export them from `shared/src/index.ts`.
  - Add schema tests for strict rejection, stale/body fields, occurrence target
    shape, and candidate response shape.
- Backend:
  - Add a pure deterministic extractor/service, likely
    `server/src/services/resource-promotions.ts`.
  - Extend `server/src/repositories/resources.ts` with candidate source reads,
    same-name resource lookup, and approval transaction helper.
  - Extend `server/src/routes/resources.ts` with:
    - `GET /api/resources/promotion-suggestions`
    - `POST /api/resources/promotion-suggestions/approve`
  - Add integration tests in `server/src/routes/resources.integration.test.ts`
    or a focused new file.
  - Update `docs/codebase-map.md` for the new API/service/UI boundary.
- Frontend:
  - Extend `web/src/Thread.tsx` to fetch current-thread promotion suggestions
    alongside thread detail/resource-focus.
  - Render a compact suggestion panel on `/threads/:id`, using tap-first
    approval. Suggested copy: "`노트북`이 여러 곳에 보여. 리소스로 묶을까?"
  - On approval success, refresh thread detail/resource-focus/suggestions and
    show the newly linked resource via the existing resource-focus section.
  - Keep failure localized to the suggestion panel; thread detail remains usable.
  - Add tests in `web/src/Thread.test.tsx`.

## Sprint Contract
- 통과 기준:
  - Suggestions are read-only and deterministic.
  - A candidate appears only when the same normalized name+kind occurs on at
    least two distinct target nodes.
  - Candidate detection covers all planned target types: event, task, thread.
  - Approval requires explicit user action and is transactional.
  - Approval creates/reuses one resource and idempotently links every occurrence.
  - Duplicate approval is idempotent: no duplicate resource link rows and the UI
    no longer shows an already-covered suggestion.
  - Existing `resource_links` firmness/reason are not overwritten.
  - No LLM, Gmail, Google Calendar, Telegram, web crawler, or external fetch is
    introduced for suggestion detection.
  - No full graph or ego-graph UI is introduced in this cycle.
  - Thread screen remains usable if suggestion fetch or approval fails.
- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static boundary check:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/resources.ts server/src/services/resource-promotions.ts server/src/repositories/resources.ts server/src/routes/resources.ts`
- 테스트 케이스:
  - Unit:
    - extractor recognizes `준비물:`/`item:` as item and `지식:`/`knowledge:` as
      knowledge;
    - extractor trims/collapses names and ignores empty/too-long names;
    - repeated same normalized name+kind across two target refs becomes one
      suggestion;
    - same name with different kind remains separate suggestions;
    - one-off mention is ignored.
  - Integration:
    - GET returns empty list when there are no repeated explicit mentions.
    - GET returns a suggestion spanning event+task, thread+event, and task+task
      combinations.
    - GET with `threadId` excludes nodes outside that thread.
    - POST approval creates a resource and all links in one transaction.
    - POST approval reuses same-name/same-kind resource.
    - POST approval rejects stale candidateKey/occurrences.
    - POST approval with missing sourcePersonId returns
      `SOURCE_PERSON_NOT_FOUND`.
    - Duplicate approval does not create duplicate links and does not overwrite
      existing link firmness/reason.
  - Frontend:
    - Thread page renders suggestion panel when suggestions exist.
    - Approval button calls POST and refreshes resource-focus/suggestions.
    - Failed suggestion fetch hides/degrades only the suggestion panel.
    - Failed approval leaves the panel visible with a local error.
    - 44px touch target and keyboard-triggerable approval button are preserved.
  - 수동:
    - Mobile Chrome light/dark check: suggestion panel readable, approval button
      reachable, and resource-focus appears after approval.
    - Reduced-motion check: no required motion for approval/refresh state.
- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개
- A repeated mention is already fully linked to an existing resource; suggestion
  must be suppressed rather than nagging again.
- Candidate source changes between GET and POST; POST must recompute and reject
  stale approval without partial writes.
- A candidate spans many nodes; A-slice should cap displayed occurrences but
  still link all approved occurrences returned by the server.

## 더 단순한 대안 1개
Only add a manual "create resource from this thread" button and skip automatic
candidate detection. This is simpler, but it violates FR-XREL-01's point:
multiple-node repetition should surface as a suggestion and the user should only
approve, not manually wire every relation.

## Assumptions
- Cycle 38 resource tables and APIs are present on `master`.
- `resource_links.target_type` remains `event | task | thread`; the spec's older
  `node` wording maps to current concrete event/task/thread targets.
- Exact same-name/same-kind resource reuse is acceptable without a new unique DB
  constraint in this single-user local deployment.
- A-level detection is allowed to be conservative and deterministic. Broader NLP
  or LLM-based mention inference belongs to a later cycle.
- Suggestion approval uses `firmness="tentative"` because repeated text is not a
  hard authored relation yet.

## Review Guidance
### Enumeration 필요 항목
- Candidate source fields must be fully enumerated:
  - Search: `rg -n "threads\\.name|threads\\.goal|events\\.title|events\\.location|tasks\\.title|tasks\\.context|promotion" server/src`
  - Expected fields: exactly `threads.name`, `threads.goal`, `events.title`,
    `events.location`, `tasks.title`, `tasks.context` unless the plan is
    explicitly amended.
- Target types must be fully enumerated:
  - Search: `rg -n "targetType|event|task|thread" shared/src/resources.ts server/src/services/resource-promotions.ts server/src/routes/resources.ts server/src/repositories/resources.ts`
  - Expected target types: `event`, `task`, `thread`; no `node`, `person`,
    `resource`, or graph-only target type.
- Mutating paths must be limited to approval:
  - Search: `rg -n "insert|update|delete|transaction|onConflict|run\\(" server/src/services/resource-promotions.ts server/src/repositories/resources.ts server/src/routes/resources.ts`
  - Expected: GET path is read-only; POST approval owns the only new transaction.
- No external/LLM boundary:
  - Search: `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|telegram|fetch\\(" shared/src/resources.ts server/src/services/resource-promotions.ts server/src/repositories/resources.ts server/src/routes/resources.ts`
  - Expected: no hits in backend/shared files.
- Frontend suggestion surface:
  - Search: `rg -n "promotion|suggestion|resource-focus|approve" web/src/Thread.tsx web/src/Thread.test.tsx web/src/styles.css`
  - Expected: suggestion fetch failure is local; approval refreshes existing
    resource-focus rather than drawing a new graph.

### 검증 방식 가이드
- Candidate extraction: pure unit tests are sufficient for text parsing rules.
- Candidate eligibility across DB rows: integration tests with temporary SQLite
  are required; mocks are insufficient because thread/event/task scoping and
  existing `resource_links` suppression are DB-dependent.
- Approval transaction/idempotency: integration tests with real temporary SQLite
  are required; mock tests cannot prove unique link behavior or rollback.
- UI fetch/approval behavior: Vitest + Testing Library is sufficient for
  interaction and degraded panel states. Manual mobile/light/dark/reduced-motion
  check remains required before merge because visual regression tests do not
  exist yet.
- Route validation: route integration tests should assert concrete status codes
  and stable error codes for validation, stale, not eligible, and missing source
  person paths.
