# Codex Review v2

## Verdict
BLOCKED

## Findings
### ISSUE-4 [MEDIUM] Thread list network failure blocks the entire `/input` hub
- Location: `web/src/InputHub.tsx:50`
- Analysis: `loadData()` loads Today and threads with `Promise.all`. If `GET /api/threads` rejects at the network layer, the catch branch sets the whole hub to `view.tag="error"`. The current regression test only covers `{ ok: false }`, not a rejected thread fetch.
- Impact: The Cycle 14 plan explicitly says thread picker failure should degrade gracefully and manual event/task creation should remain usable without thread assignment. A network failure in the optional thread picker currently hides the input hub.
- Fix Direction: Load Today as the required request, and treat thread fetch as optional with its own `try/catch` or `Promise.allSettled`. On thread failure, continue with `threads=[]`. Add a test where `/api/threads` rejects and `/input` still renders quiet/live input sections.

## Previous Issue Status
- ISSUE-1: RESOLVED
- ISSUE-2: RESOLVED
- ISSUE-3: RESOLVED

## Regression Check
- Timezone serialization now uses local offset helpers.
- `/input` Today and slot date requests now use local date.
- Quick capture failure now renders local error.
- New remaining issue is limited to thread-picker network failure behavior.

## Sprint Contract Check
- `/today`, `/input`, `/threads`, `/threads/new`, and `/threads/:id` render app navigation: PASS
- Navigation has links to `/today`, `/input`, `/threads`: PASS
- Current route sets `aria-current="page"`: PASS
- `/input` quick capture posts to `POST /api/capture/flat-event`: PASS
- `/input` quick capture empty submit does not call fetch: PASS
- `/input` manual event form posts to `POST /api/events`: PASS
- `/input` manual task form posts to `POST /api/tasks`: PASS
- `/input` thread picker uses `GET /api/threads` and degrades gracefully: FAIL for network rejection
- `/input` lists unscheduled events from Today `unscheduledEvents`: PASS
- `/input` can load slot candidates and schedule an unscheduled event: PASS
- Failed quick capture/manual add/candidate load/schedule actions keep the relevant input visible and show local error: PASS
- Today still renders quick capture and existing schedule prompt cards: PASS
- No LLM imports are added to deterministic Today or slot code: PASS
- No DB migration is added: PASS
- `docs/codebase-map.md` is updated: PASS

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm test:integration`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check`: PASS

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-4: APPLY

### Applied

RESOLVED: ISSUE-4 — thread fetch network rejection no longer blocks the hub
- `loadData()` changed from `Promise.all` to `Promise.allSettled`
- Today fetch is the required request: rejection → hub error state
- Thread fetch is optional: rejection or `ok: false` → `threads = []`, hub renders normally
- Added test: `/api/threads` rejects with `Promise.reject` → hub still shows quiet state and capture input

자동 체크: lint ✅ / typecheck ✅ / test ✅ (85 web, 132 integration) / build ✅ / git diff --check ✅
