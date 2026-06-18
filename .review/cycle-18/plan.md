# Decision Conflict A 구현 계획

Branch: `feature/cycle-18-decision-conflict-a`
Cycle: `18`
Created: `2026-06-18`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Today already detects overlapping events and renders conflict cards, but the
card is mostly informational. Cycle 18 turns conflict cards into a deterministic
decision surface: show overlap, show separate cost chips for each side, mark a
non-binding lower-cost suggestion when the comparison is clear, and let the
user resolve the conflict by marking one event `moved` or `cancelled`.

This is Decision A, not the full decision engine. It keeps the first useful
behavior small and local to Today.

Out of scope:
- Finding a new time for the moved event.
- Sending notification drafts.
- People hard-constraint blocking.
- Gmail/refund enrichment.
- GCal mirror mutation.
- Three-or-more conflict UX beyond pair cards.
- New ledger table.
- New DB migration.
- New LLM use.

Preparation pass creates only `.review/cycle-18/*` artifacts and stops before
implementation.

## 입력/출력 명세

- `GET /api/decisions/conflicts?date=YYYY-MM-DD&now=<ISO datetime>`
  - Input:
    - `date`: literal `YYYY-MM-DD`.
    - `now`: parseable ISO datetime.
  - Output:
    - Success: `{ ok: true, data: { conflicts: ConflictDecision[] } }`.
  - Failure:
    - `400 VALIDATION_ERROR`.
  - Deterministic. No LLM gateway import.

- `ConflictDecision`
  - `id`: stable ephemeral id, e.g. `${a.id}:${b.id}` with ids sorted ascending.
  - `pair`: `{ a: EventRow, b: EventRow }`.
  - `overlapMinutes`.
  - `urgency`: `near | planning`, near when either event starts within 6 hours of `now`.
  - `options`: exactly two entries, one per event:
    - `event`: `EventRow`.
    - `action`: `move_or_cancel`.
    - `cost`: `{ money, social, effort, window }`, numeric nullable values from `events.cancel_*`.
    - `reversible`: event reversible flag.
    - `commitment`: event commitment.
    - `suggested`: boolean.
    - `reasonCodes`: stable machine-readable strings.
  - No public scalar total is returned.
  - Suggestion rule:
    - Internal comparison may sum known numeric `cancel_*` values plus simple non-reversible penalty for ordering only.
    - If both sides tie or all cost fields are unknown/zero, no suggestion.
    - Suggestion label is advisory only; user still chooses.

- `POST /api/decisions/conflicts/resolve`
  - Input body:
    - `keepEventId`: positive integer.
    - `changeEventId`: positive integer.
    - `outcome`: `moved | cancelled`.
    - `note`: optional non-empty string after trim.
  - Behavior:
    - Validate both events exist.
    - Validate the two events currently overlap; otherwise `409 CONFLICT_STALE`.
    - Update `changeEventId` status to `outcome`.
    - Insert an annotation row for `changeEventId` as decision ledger:
      - `outcome`: selected outcome.
      - `reason_tags`: JSON string containing `["conflict_resolution"]`.
      - `reason_text`: user note when provided, otherwise deterministic system text such as `conflict_resolution`.
      - `energy_at_time`: null.
    - Return `{ ok: true, data: { changedEvent, annotation } }`.
  - Failure:
    - `400 VALIDATION_ERROR`.
    - `404 NOT_FOUND`.
    - `409 CONFLICT_STALE`.
  - Deterministic. No LLM gateway import.

- `GET /api/today`
  - Existing `conflict` cards remain first-priority cards.
  - Frontend may use Today conflict pairs directly for rendering, but conflict
    detail/options must match backend decision service behavior.

## Key Changes

- Shared:
  - Add `decision.ts` schemas/types:
    - `ConflictDecisionOptionSchema`.
    - `ConflictDecisionSchema`.
    - `ConflictDecisionsResponseDataSchema`.
    - `ResolveConflictRequestSchema`.
    - `ResolveConflictResponseDataSchema`.
  - Export from `shared/src/index.ts`.

- Backend:
  - Add deterministic decision service:
    - conflict pair generation for planned/confirmed day events.
    - overlap minutes.
    - separate cost extraction.
    - internal suggestion ordering with no public scalar.
    - stale-overlap check for resolve.
  - Add `server/src/routes/decisions.ts`.
  - Register decision route in `app.ts` when DB exists.
  - Reuse existing event repository helpers where possible.
  - Reuse annotations repository or add a narrow structured insert helper.
  - Keep all decision behavior gateway-free.

- Frontend:
  - Make Today conflict cards actionable.
  - Add conflict decision bottom sheet:
    - overlap summary.
    - event A/B titles and time windows.
    - cost chips split by money/social/effort/window.
    - advisory suggestion label when present.
    - buttons: mark this event moved, mark this event cancelled.
  - Submit calls `POST /api/decisions/conflicts/resolve`, then refetches Today.
  - On submit failure, keep sheet open and show local error.
  - Preserve existing event detail sheet, schedule prompt, needs-review, and
    feasibility UI behavior.

- Docs:
  - Update `docs/codebase-map.md` after implementation with decision route,
    service, shared contract, and Today conflict sheet locations.

## Sprint Contract

- 통과 기준:
  - `GET /api/decisions/conflicts` validates `date` and `now`.
  - Conflict list includes only planned/confirmed scheduled events for the date.
  - Non-overlapping events are excluded.
  - Overlap minutes are calculated using epoch milliseconds.
  - Cost breakdown exposes money/social/effort/window separately.
  - No public scalar total is returned.
  - Suggestion appears when one option is clearly lower cost.
  - No suggestion appears on tie or all-zero/unknown costs.
  - `POST /api/decisions/conflicts/resolve` validates body.
  - Resolve rejects missing events.
  - Resolve rejects stale non-overlap with `409 CONFLICT_STALE`.
  - Resolve updates selected event status to `moved` or `cancelled`.
  - Resolve inserts annotation ledger row.
  - Today conflict card opens decision sheet.
  - Sheet action posts resolve payload and refetches Today.
  - Failed resolve keeps sheet open with error.
  - Existing Today event detail sheet still opens from event surfaces.
  - Existing feasibility panel still renders.
  - No LLM gateway imports in decision service/route/Today conflict UI.
  - No migration is added.
  - `docs/codebase-map.md` is updated.

- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- 테스트 케이스:
  - Backend integration: conflict list empty for no overlap.
  - Backend integration: overlapping planned/confirmed events produce one conflict.
  - Backend integration: excluded statuses do not produce conflicts.
  - Backend integration: overlap minutes use epoch math, including mixed offsets.
  - Backend integration: cost chips keep separate fields.
  - Backend integration: response contains no scalar total field.
  - Backend integration: suggestion appears for lower known cost.
  - Backend integration: no suggestion for tie/all-zero.
  - Backend integration: resolve updates chosen event status.
  - Backend integration: resolve inserts annotation ledger row.
  - Backend integration: resolve stale pair returns 409.
  - Backend integration: no LLM gateway import in decision modules.
  - Frontend: conflict card opens decision sheet.
  - Frontend: sheet renders cost chips and suggestion.
  - Frontend: moved/cancelled action posts resolve payload and refetches Today.
  - Frontend: failed resolve keeps sheet open and shows error.
  - Frontend regression: feasibility panel, event detail sheet, schedule prompt, and needs-review reply still work.

- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- Three events overlap in one time cluster. Cycle 18 may show pair cards rather
  than a global optimizer; reviewer should ensure pair ids are stable and no UI crash occurs.
- Both events have null/zero cost fields. UI must avoid fake certainty and show
  no suggestion.
- User opens sheet, then another action resolves one event. Resolve must recheck
  overlap and return stale conflict instead of blindly updating.

## 더 단순한 대안 1개

Only add moved/cancelled buttons directly on conflict cards. This is faster, but
it hides the cost breakdown that defines Decision. A bottom sheet is still small
and matches the existing mobile action pattern.

## Assumptions

- Existing `events.cancel_*`, `reversible`, and `commitment` fields are enough
  for Decision A.
- Existing `annotations` table can act as the first decision ledger; no new
  ledger table in this cycle.
- `reason_tags` can store a JSON string array.
- Recommendation is advisory only and never auto-applied.
- Notification draft generation waits for People/Decision later cycles.

## Review Guidance

### Enumeration 필요 항목

- Decision boundary:
  - Search: `rg -n "ConflictDecision|conflict_resolution|decisions/conflicts|ResolveConflict" shared/src server/src web/src docs/codebase-map.md`
  - Expected: shared contract, server route/service, Today UI, tests, codebase map.

- Cost scalar leak:
  - Search: `rg -n "totalCost|costTotal|score|scalar" shared/src server/src web/src`
  - Expected: internal score may exist in server service only if not returned; shared/web should expose separated cost fields only.

- Today conflict UI:
  - Search: `rg -n "conflict.*sheet|decision|moved|cancelled|conflict_resolution" web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: open sheet, render chips, submit resolve, refetch Today.

- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src web/src`
  - Expected: no decision service/route dependency on LLM.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.

### 검증 방식 가이드

- Backend conflict/resolve behavior requires real temporary SQLite integration
  tests because status updates, annotation ledger insert, and stale conflict
  checks must be proven against persisted rows.
- Frontend can use mocked fetch, but must verify request URL, payload, Today
  refetch, and failure state.
- Reviewer should treat rescheduling, notification drafts, people hard
  constraints, and Gmail enrichment as scope creep.
