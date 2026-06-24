# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Unplanned EgoSheet keyboard/focus behavior change
- 위치: `web/src/EgoSheet.tsx:50`
- 분석: Cycle 47 plan scopes `FR-BRF-04` preparation suggestions in event detail. The diff also rewrites shared ego-graph sheet keyboard handling from document/backdrop listeners to a React `onKeyDown` path, and updates `docs/codebase-map.md` for that behavior. This surface is unrelated to event preparation suggestions.
- 영향: Sprint Contract requires no scope creep. This is a functional UI behavior change outside the plan, so the cycle cannot be accepted as-is even if tests pass.
- 수정 방향: Revert the `EgoSheet` and related codebase-map changes from this cycle, or move them into a separate planned cycle with its own review scope.

### ISSUE-2 [MEDIUM] Required static no-scope-creep check fails
- 위치: `shared/src/eventDetail.ts:78`
- 분석: The plan's static no out-of-scope section-11 command finds `procurement` in an implementation comment:
  `git diff -U0 master..HEAD -- shared/src server/src web/src ':!**/*.test.ts' ':!**/*.test.tsx' | rg -n "procurement|proc_|vendor|venue|domain|travelOption|routeOption|manualKnowledge|rental"`
- 영향: Sprint Contract says all automatic checks must pass. Even though this appears to be a comment-only false positive, the required command currently exits with a match.
- 수정 방향: Reword the comment so the required static command has no matches, without weakening the schema or broadening scope.

## Sprint Contract Check
- `ScheduleBriefSchema` requires `preparationSuggestions`: PASS.
- Strict suggestion object schema: PASS.
- Presentation/demo keywords produce `노트북`, `충전기`, `어댑터`: PASS.
- No trigger returns empty suggestions: PASS.
- Stable deterministic order: PASS.
- `brief_preparation_suggestions` only when suggestions are non-empty: PASS.
- Existing visible preparations suppress same-name suggestions: PASS.
- GET detail read-only row-count coverage: PASS by integration test evidence.
- Event detail UI renders suggestions only when present and no POST on initial render: PASS by UI tests.
- Accept suggestion posts `{ name }`, refetches, and handles duplicate success: PASS by UI/backend path evidence.
- Failed acceptance keeps sheet usable and suggestion visible: PASS by UI test.
- No LLM/external/map calls: PASS.
- No procurement/rental/contact/domain/movement scope: FAIL, static command match in `shared/src/eventDetail.ts`.
- Manual mobile/light/dark/reduced-motion: NOT RUN in this review; still needs final evidence before merge if no direct device check is provided.

## Automatic Checks
- `corepack pnpm db:generate`: PASS.
- `corepack pnpm verify`: PASS.
- `git diff --check master..HEAD`: PASS.
- Static no LLM/external/map command: PASS (no matches; `rg` exit 1).
- Static no GET write command: PASS (no matches; `rg` exit 1).
- Static no out-of-scope section-11 fields command: FAIL (`shared/src/eventDetail.ts:78`).

## Changes Outside Plan
- `web/src/EgoSheet.tsx` and its `docs/codebase-map.md` entry were changed, but Cycle 47 plan does not include ego-graph sheet keyboard/focus work.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY

### Applied

RESOLVED: ISSUE-1 — out-of-scope EgoSheet change reverted
- The cycle-47 diff had rewritten `web/src/EgoSheet.tsx` keyboard handling (useEffect document listener → React `onKeyDown` prop) plus its `docs/codebase-map.md` entry. This is unrelated to FR-BRF-04 preparation suggestions — it was added opportunistically to suppress a PRE-EXISTING intermittent flake in the Thread "Escape closes the ego sheet" test that broke one verify run.
- Reverted `web/src/EgoSheet.tsx` to the master version (`git checkout master -- web/src/EgoSheet.tsx`; `git diff master -- web/src/EgoSheet.tsx` is now empty) and reverted the codebase-map EgoSheet `onKeyDown` sentence. The ego-sheet flake is a pre-existing master concern, to be handled in its own scoped cycle, not here.
- "Changes Outside Plan" is now empty: remaining cycle-47 changes are all in-scope (suggestion schema, `preparationSuggestions` service, `buildScheduleBrief` param, route assembly, Today UI + tests, docs).

RESOLVED: ISSUE-2 — static no-scope-creep command passes
- `shared/src/eventDetail.ts`: the suggestion comment contained the literal `procurement`, which the plan's exact command flags even inside a comment. Reworded to "No LLM and no external/movement/buying fields; not auto-applied" (no banned token). Schema unchanged.
- After committing, `git diff -U0 master..HEAD -- shared/src server/src web/src ':!**/*.test.ts' ':!**/*.test.tsx' | rg -n "procurement|proc_|vendor|venue|domain|travelOption|routeOption|manualKnowledge|rental"` returns no hits.

자동 체크: lint ✅ / typecheck ✅ / test ✅ (shared 290 / server 359 / web 351) / test:integration ✅ / build ✅ / `corepack pnpm verify` EXIT=0 / `git diff --check master..HEAD` clean / db:generate no changes / static no-LLM/external + no-GET-write + no-scope-creep **0 hits** (post-commit)
