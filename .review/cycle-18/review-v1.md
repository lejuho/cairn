# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Resolve accepts stale status conflicts
- 위치: `server/src/routes/decisions.ts:42`
- 분석: Resolve transaction only checks that both events exist and that their time ranges overlap. It does not verify that both rows still have an active conflict status (`planned` or `confirmed`) before updating `changeEventId`.
- 영향: The plan's stale edge case says if another action already resolves one event, resolve must return stale instead of blindly updating. If an event is already `moved` or `cancelled` but still has the old start/end, this route still updates it again and inserts another annotation.
- 수정 방향: In the transaction, treat either event outside `planned|confirmed` as `409 CONFLICT_STALE`, alongside the existing overlap check. Add an integration test where one event is changed to `moved` or `cancelled` before calling resolve.

### ISSUE-2 [MEDIUM] Same event can resolve against itself
- 위치: `shared/src/decision.ts:39`
- 분석: `ResolveConflictRequestSchema` only requires positive integer ids. The route then fetches both ids independently and `eventsOverlap` will be true for one scheduled event compared with itself.
- 영향: `POST /api/decisions/conflicts/resolve` can mark a single event `moved` or `cancelled` and insert a conflict ledger without a real two-event conflict. This violates the pair-based conflict contract.
- 수정 방향: Reject `keepEventId === changeEventId` as `400 VALIDATION_ERROR` in the shared schema or route validation. Add an integration test for the same-id request.

### ISSUE-3 [MEDIUM] Reversible flag can create suggestion when cost fields are zero
- 위치: `server/src/services/decision.ts:122`
- 분석: `hasKnownCost` treats `reversible=0` as a known cost and `internalScore` adds a non-reversible penalty. With all `cancel_*` cost fields zero/unknown, a reversible difference can still make one option suggested.
- 영향: The plan requires no suggestion on tie or all-zero/unknown costs. Existing tests cover both sides defaulting to zero, but not the all-zero plus reversible-difference case.
- 수정 방향: Gate suggestions on at least one actual cost field being known/non-zero, and use the non-reversible penalty only after that gate. Add an integration test with all cost fields zero and only `reversible` differing.

## Sprint Contract Check
- `GET /api/decisions/conflicts` validates `date` and `now`: PASS.
- Conflict list includes only planned/confirmed scheduled events for the date: PASS for GET.
- Non-overlapping events are excluded: PASS.
- Overlap minutes use epoch milliseconds: PASS.
- Cost breakdown exposes money/social/effort/window separately: PASS.
- No public scalar total is returned: PASS.
- Suggestion appears when one option is clearly lower cost: PASS.
- No suggestion appears on tie or all-zero/unknown costs: BLOCKED by ISSUE-3.
- `POST /api/decisions/conflicts/resolve` validates body: BLOCKED by ISSUE-2.
- Resolve rejects missing events: PASS.
- Resolve rejects stale non-overlap with `409 CONFLICT_STALE`: PARTIAL; non-overlap passes, stale status blocked by ISSUE-1.
- Resolve updates selected event status to `moved` or `cancelled`: PASS.
- Resolve inserts annotation ledger row: PASS.
- Today conflict card opens decision sheet: PASS by test coverage.
- Sheet action posts resolve payload and refetches Today: PASS by test coverage.
- Failed resolve keeps sheet open with error: PASS by test coverage.
- Existing Today event detail sheet still opens from event surfaces: PASS by regression coverage.
- Existing feasibility panel still renders: PASS by regression coverage.
- No LLM gateway imports in decision service/route/Today conflict UI: PASS.
- No migration is added: PASS.
- `docs/codebase-map.md` is updated: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS.
- `corepack pnpm test:integration`: PASS.
- `corepack pnpm verify`: PASS.
- `git diff --check`: PASS.

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-1 — stale status check added to resolve transaction

- `server/src/routes/decisions.ts:42`: before overlap check, verify both `keepEvent.status` and `changeEvent.status` are `planned|confirmed`; return `{ status: 409 }` if either is already `moved|cancelled`
- Integration tests: `returns 409 CONFLICT_STALE when changeEvent already moved/cancelled`, `...keepEvent already cancelled`

RESOLVED: ISSUE-2 — same-id rejection added to shared schema

- `shared/src/decision.ts`: `.refine()` on `ResolveConflictRequestSchema` rejects `keepEventId === changeEventId` as `400 VALIDATION_ERROR`
- Integration test: `returns 400 when keepEventId and changeEventId are the same`

RESOLVED: ISSUE-3 — reversible removed from hasKnownCost gate

- `server/src/services/decision.ts:122`: removed `reversibleKnown` from `hasKnownCost`; reversible penalty still used in `internalScore` for ordering after the cost gate clears, but can no longer be the sole trigger for a suggestion
- Integration test: `no suggestion when cost fields are all zero/none and only reversible differs`

자동 체크: test:integration ✅ (216 tests) / verify ✅
