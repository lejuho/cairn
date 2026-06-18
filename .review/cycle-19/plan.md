# Decision NOW Gating 구현 계획

Branch: `feature/cycle-19-decision-now-gating`
Cycle: `19`
Created: `2026-06-18`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Cycle 18 made conflict cards actionable: cost chips, advisory suggestion, and
resolve-to-moved/cancelled. Cycle 19 adds the missing FR-DEC-05 layer: conflicts
far from `now` are informational planning signals, while only near conflicts are
actionable.

This keeps Decision deterministic and small before moving into People hard
constraints, Gmail/refund enrichment, or notification drafts.

Preparation pass creates only `.review/cycle-19/*` artifacts and stops before
implementation.

Out of scope:
- People social-cost adjustment.
- People hard-constraint blocking.
- Notification draft generation.
- GCal mirror mutation.
- Gmail/refund parsing.
- New migrations.
- New LLM use.

## 입력/출력 명세

- `GET /api/decisions/conflicts?date=YYYY-MM-DD&now=<ISO datetime>`
  - Input:
    - `date`: literal `YYYY-MM-DD`.
    - `now`: parseable ISO datetime.
  - Output:
    - Success: `{ ok: true, data: { conflicts: ConflictDecision[] } }`.
    - Each conflict keeps existing `urgency: "near" | "planning"`.
    - Add deterministic actionability to each conflict:
      - `actionability: "resolvable" | "read_only"`.
      - `disabledReasonCodes: string[]`.
    - `resolvable` means at least one event start is in the future and within
      the near horizon.
    - `read_only` means the conflict is detected but resolve buttons must not
      be active yet.
  - Failure:
    - `400 VALIDATION_ERROR`.
  - Deterministic. No LLM gateway import.

- Near horizon rule:
  - Default: 6 hours.
  - `resolvable` only when either event starts at or after `now` and within
    `now + 6h`.
  - Far-future conflicts remain visible as planning signals.
  - Past-start conflicts are not newly actionable by this gate; if they still
    qualify by existing Today/review rules, later cycles may handle them through
    review/annotation rather than conflict resolve.

- `POST /api/decisions/conflicts/resolve`
  - Existing input body remains:
    - `keepEventId`: positive integer.
    - `changeEventId`: positive integer and different from `keepEventId`.
    - `outcome`: `moved | cancelled`.
    - `note`: optional non-empty string after trim.
  - Add query or body `now` only if implementation proves the route cannot
    reliably apply NOW gating without it. Preferred shape is body field:
    - `now?: ISO datetime`, default server current time.
  - Behavior:
    - Validate both events exist and are still active.
    - Validate overlap.
    - Validate conflict is currently `resolvable`; otherwise reject.
    - Update `changeEventId` status and insert annotation ledger only after all
      deterministic checks pass.
  - Failure:
    - `400 VALIDATION_ERROR`.
    - `404 NOT_FOUND`.
    - `409 CONFLICT_STALE` for missing current overlap or inactive status.
    - `409 CONFLICT_NOT_ACTIONABLE` for planning/far-future conflicts.
  - Deterministic. No LLM gateway import.

- `GET /api/today`
  - Existing conflict cards remain first-priority cards.
  - Conflict cards for `read_only` conflicts must show the overlap/cost chips
    but disable moved/cancelled actions.
  - `resolvable` conflicts keep the Cycle 18 action sheet behavior.

## Key Changes

- Shared:
  - Extend `ConflictDecisionSchema` with:
    - `actionability: z.enum(["resolvable", "read_only"])`.
    - `disabledReasonCodes: z.array(z.string())`.
  - Extend resolve request schema with `now` only if route-level NOW checking
    needs a deterministic test clock.
  - Export any new constants/types from `shared/src/index.ts`.

- Backend:
  - Update decision service to compute actionability from `now`, start times,
    and a 6-hour near horizon.
  - Keep `urgency` consistent with actionability.
  - Update resolve route to re-check actionability inside the same transaction
    before status update and annotation insert.
  - Return `409 CONFLICT_NOT_ACTIONABLE` without partial writes when a
    read-only conflict is posted.
  - Keep decision service/route gateway-free.

- Frontend:
  - Update Today conflict sheet to render planning/read-only state.
  - Disable moved/cancelled buttons for read-only conflicts.
  - Show short copy such as "아직 계획 구간이라 해소 버튼은 잠가둠".
  - Preserve cost chips, advisory suggestion, failed resolve behavior, event
    detail sheet, schedule prompt, needs-review, and feasibility UI.

- Docs:
  - Update `docs/codebase-map.md` after implementation to mention decision
    actionability and read-only planning conflict behavior.

## Sprint Contract

- 통과 기준:
  - Conflict decision response includes `actionability` and
    `disabledReasonCodes`.
  - Near conflict within 6 hours is `resolvable`.
  - Far-future conflict is `read_only`.
  - Past-start conflict is not made `resolvable` solely because its start is
    earlier than `now`.
  - Read-only conflict still exposes overlap, pair, cost chips, and suggestion
    data.
  - Resolve accepts currently `resolvable` conflicts.
  - Resolve rejects read-only conflicts with `409 CONFLICT_NOT_ACTIONABLE`.
  - Resolve rejection performs no status update and no annotation insert.
  - Existing stale inactive/non-overlap checks still return `409 CONFLICT_STALE`.
  - Today sheet disables resolve buttons for read-only conflicts.
  - Today sheet keeps buttons enabled for resolvable conflicts.
  - Existing Cycle 18 conflict action flow still posts and refetches.
  - No LLM gateway imports in decision service/route/Today conflict UI.
  - No migration is added.
  - `docs/codebase-map.md` is updated.

- 자동 체크:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- 테스트 케이스:
  - Backend integration: conflict starting in 2 hours is `resolvable`.
  - Backend integration: conflict starting in 8 hours is `read_only`.
  - Backend integration: conflict that started before `now` is not
    accidentally `resolvable`.
  - Backend integration: read-only conflict retains existing cost chip fields
    and no scalar total.
  - Backend integration: resolve read-only pair returns
    `409 CONFLICT_NOT_ACTIONABLE`.
  - Backend integration: read-only resolve has no partial event/annotation
    write.
  - Backend integration: existing stale status and stale non-overlap tests
    continue passing.
  - Frontend: read-only conflict sheet renders disabled action buttons and
    explanatory copy.
  - Frontend: resolvable conflict sheet still submits resolve payload and
    refetches Today.
  - Frontend regression: event detail sheet, schedule prompt, needs-review, and
    feasibility panel still render.

- gas 한도: N/A
- slither 통과: N/A

## 누락된 엣지 케이스 후보 3개

- One event starts in the past and the other starts soon. Reviewer should verify
  the rule is explicit and does not unlock confusing late conflict actions.
- User opens a resolvable sheet, time passes beyond the gate, then posts
  resolve. Route must re-check using current `now`/test clock and reject if no
  longer actionable.
- Three overlapping events produce multiple pair cards with mixed
  `resolvable/read_only` states. UI must not disable the whole conflict stack
  because one pair is read-only.

## 더 단순한 대안 1개

Only disable buttons in the frontend based on existing `urgency`. This is
faster, but it leaves the server able to mutate far-future conflicts. Rechecking
actionability in the route is required because suggestions never mutate
decisions automatically and UI state is not a security or consistency boundary.

## Assumptions

- Cycle 19 priority is FR-DEC-05 NOW distance gating.
- The near horizon default remains 6 hours, matching Cycle 18 urgency wording.
- No user-configurable parameter is added in this cycle.
- `read_only` means "show the conflict and cost information, but do not allow
  resolve mutation yet".
- This cycle does not attempt to solve late/past conflict recovery; needs-review
  and annotation flows own post-event reflection.
- Deterministic decision code remains available when the Grok proxy is down.

## Review Guidance

### Enumeration 필요 항목

- Decision actionability contract:
  - Search: `rg -n "actionability|disabledReasonCodes|CONFLICT_NOT_ACTIONABLE|read_only|resolvable" shared/src server/src web/src docs/codebase-map.md`
  - Expected: shared schema, decision service/route, Today UI/tests, codebase map.

- Resolve mutation boundary:
  - Search: `rg -n "update\\(events\\)|insert\\(annotations\\)|CONFLICT_NOT_ACTIONABLE|CONFLICT_STALE" server/src/routes/decisions.ts server/src/routes/decisions.integration.test.ts`
  - Expected: actionability check happens before event update and annotation insert; tests prove no partial writes.

- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src/routes/decisions.ts server/src/services/decision.ts web/src/Today.tsx`
  - Expected: no matches.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files beyond existing committed migrations.

- Today conflict UI:
  - Search: `rg -n "conflict|decision|read_only|resolvable|disabled" web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: read-only copy and disabled buttons covered, resolvable action flow preserved.

### 검증 방식 가이드

- Backend actionability and resolve behavior require real temporary SQLite
  integration tests because route-level no-partial-write behavior must be
  proven against persisted rows.
- Frontend can use mocked fetch responses, but must verify disabled buttons do
  not call resolve and resolvable buttons still call resolve then refetch Today.
- Mock-only tests are insufficient for stale/actionability transaction ordering.
- Reviewer should treat People constraints, Gmail enrichment, notification
  drafts, or parameter UI as scope creep for this cycle.
