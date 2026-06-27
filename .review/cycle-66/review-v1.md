# Codex Review v1

## Verdict
READY_TO_MERGE

## Findings
None.

## Sprint Contract Check
- `GET /api/threads/:id` returns `personFocus.people` from in-thread `event_people`: PASS. `getThreadDetail` composes `personFocus` from the loaded thread event ids, and backend integration tests exercise the route response.
- People are unique and sorted by name/id: PASS. `findThreadPersonFocus` groups by person id and sorts rows by name, then id; integration coverage verifies deterministic person ordering.
- Each row's `eventIds` are unique and sorted ascending: PASS. The repository uses a `Set` per person and sorts the emitted event ids; integration coverage verifies multi-event aggregation.
- Out-of-thread `event_people` rows are excluded: PASS. The helper only receives event ids loaded for the requested thread; integration coverage verifies another thread's person rows do not leak.
- No-people thread returns `personFocus.people: []`: PASS. Repository returns an empty array for empty event ids/no joins, and integration coverage verifies the route payload.
- Backend path is read-only: PASS. Added backend code is select/group/compose only; row-count preservation integration coverage passes.
- Person focus section hides for empty payload: PASS. Frontend tests cover the empty state.
- Person chips are keyboard-focusable 44px buttons: PASS. The UI renders native buttons and `.person-chip` has `min-height: 44px`.
- Selecting a person highlights matching event nodes and dims unrelated event/task nodes: PASS. `nodeClass` applies exactly one focus mode and frontend tests cover matching event, unrelated event, and task dimming.
- Tapping the active person chip clears focus classes: PASS. Frontend tests cover same-chip toggle clear.
- Existing resource focus remains available when no person focus is active: PASS. Resource focus code remains in the same section and tests cover resource/person clearing behavior.
- Resource focus and person focus are mutually exclusive: PASS. Selecting either mode clears the other; frontend tests cover both directions.
- Focus chip clicks do not fetch/mutate/schedule/edit/confirm/open graph UI: PASS. Person chip handlers only update local React state; tests assert no extra network/mutation calls.
- No migration, new route, LLM, external API, Gmail/GCal, Mirror, movement, watcher, procurement, notification, push, or CV/export behavior: PASS. Static checks show no implementation matches; the docs-only `CV` false positive is from existing `docs/codebase-map.md` contract prose.
- UI remains mobile-first, semantic-token based, keyboard focusable, and 44px+: PASS. Added CSS uses design tokens and reduced-motion handling.
- `docs/codebase-map.md` reflects the boundary: PASS.

## Automatic Checks
- `corepack pnpm lint`: PASS (via `corepack pnpm verify`)
- `corepack pnpm typecheck`: PASS (via `corepack pnpm verify`)
- `corepack pnpm test`: PASS (via `corepack pnpm verify`; shared 418 tests, server 470 tests, web 441 tests)
- `corepack pnpm test:integration`: PASS (via `corepack pnpm verify`; server integration 675 tests)
- `corepack pnpm build`: PASS (via `corepack pnpm verify`)
- `corepack pnpm verify`: PASS
- `git diff --check master...HEAD`: PASS
- `git diff --name-only master...HEAD | rg 'server/drizzle|server/src/db/schema.ts'`: PASS (no matches)
- `git diff --name-only master...HEAD -- server/src/routes/threads.ts`: PASS (no route handler source change)
- `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'gcal|gmail|mirror|movement|watcher|procurement|cron|scheduler|notification|push|llm|Grok|proxy|CV|position|trade|expense'`: PASS (no implementation matches)
- `git diff -U0 master...HEAD -- server/src | rg -n '\\.(insert|update|delete)\\(|method: "(POST|PATCH|DELETE)"|app\\.(post|patch|delete)'`: PASS (no matches)

## Changes Outside Plan
None.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED
