# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Workflow/source-of-truth files were changed outside the cycle plan
- Location: AGENTS.md:250
- Location: AGENTS.md:299
- Location: .claude/CLAUDE.md:87
- Location: .claude/settings.json:66
- Analysis: Cycle 51 plan scopes Thread Draft A implementation: shared draft schemas, LLM parser, draft persistence service/route, `/threads/new` UI, and `docs/codebase-map.md`. The diff also modifies global workflow contracts and hook configuration (`AGENTS.md`, `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/check-marker-sync.sh`, `CONTRACT_MARKERS.md`) and adds `.claude/hooks/write-executor-done.sh`. It also creates `.review/cycle-51/executor/pass-001-done.json` and `.review/cycle-51/.read-counter` based on that new workflow.
- Impact: Violates the plan scope and the repository rule against arbitrary critical workflow/config changes. This prevents merge even if the Thread Draft feature itself passes tests.
- Fix direction: Remove the executor-done workflow/hook/settings/marker changes and generated workflow artifacts from this cycle, or move them to a separately approved workflow cycle with its own plan and review.

### ISSUE-2 [HIGH] Placeholder unknown text can be persisted as factual draft data
- Location: shared/src/threadDraft.ts:51
- Location: shared/src/threadDraft.ts:52
- Location: shared/src/threadDraft.ts:61
- Location: shared/src/threadDraft.ts:64
- Location: shared/src/threadDraft.ts:75
- Location: server/src/services/threadDraft.ts:75
- Location: server/src/services/threadDraft.ts:76
- Location: server/src/services/threadDraft.ts:77
- Location: server/src/services/threadDraft.ts:93
- Location: server/src/services/threadDraft.ts:96
- Location: server/src/services/threadDraft.ts:118
- Analysis: The plan requires unknown values to remain `null`/omitted and says placeholder strings such as `?`, `unknown`, or `TBD` must not be stored as facts. Date fields reject placeholders, but nullable text fields are plain `z.string().nullable().optional()`. The service then persists those strings directly into thread kind/goal, event type/location, and task context.
- Impact: `FR-THR-03` is not fully satisfied. A valid LLM response can store `location: "TBD"` or `context: "unknown"` as durable data instead of surfacing it as input-needed uncertainty.
- Fix direction: Add a shared nullable draft-text schema that trims and rejects or normalizes placeholder-only values for all nullable textual fields, then add shared and integration tests proving placeholders are not persisted.

### ISSUE-3 [MEDIUM] `timeZone` accepts arbitrary non-empty strings despite the request contract
- Location: shared/src/threadDraft.ts:17
- Analysis: The request spec says `timeZone` is an optional IANA timezone string, but the schema currently accepts any non-empty string. This value is passed into the LLM prompt for relative-date parsing.
- Impact: Bad timezone input can make relative date parsing ambiguous or wrong while still passing validation.
- Fix direction: Validate `timeZone` with `Intl.DateTimeFormat(undefined, { timeZone })` or a small helper that rejects invalid IANA timezone names; add a schema test.

## Sprint Contract Check
- `POST /api/threads/draft` creates a persisted draft thread with nodes/links: PASS by integration tests.
- All created dependency links are `soft/inferred`: PASS by service code and integration tests.
- Draft events/tasks attach to the created thread: PASS by integration tests.
- Unknown values remain empty/null and are visible as warnings/input-needed copy: BLOCKED by ISSUE-2.
- Invalid LLM output, dangling links, invalid dates/enums, and gateway failures produce no partial DB writes: PASS for covered cases.
- Existing manual `POST /api/threads` and `/threads/new` manual create flow remain stable: PASS by tests.
- Today, slot, feasibility, decision, watcher, and mirror behavior unchanged: PASS by full verify, but workflow files changed outside plan; see ISSUE-1.
- `docs/codebase-map.md` reflects the new boundary: PASS for Thread Draft A content.

## Automatic Checks
- `corepack pnpm db:generate`: PASS
  - No schema changes, nothing to migrate.
- `corepack pnpm verify`: PASS
  - Lint, typecheck, unit tests, shared build, SQLite integration tests, and build passed.
  - Integration: 28 files, 596 tests passed.
- `git diff --check`: PASS
- `git diff --check master..HEAD`: PASS, but currently not meaningful for implementation content because the feature changes are uncommitted on the branch.
- Hook smoke (`.codex/hooks/*.sh`): PASS
- `bash .claude/hooks/check-marker-sync.sh`: PASS
- Static scope review: BLOCKED by ISSUE-1.
- Static unknown/fabrication review: BLOCKED by ISSUE-2 and ISSUE-3.

## Changes Outside Plan
- `.claude/CLAUDE.md`
- `.claude/hooks/check-marker-sync.sh`
- `.claude/hooks/write-executor-done.sh`
- `.claude/settings.json`
- `AGENTS.md`
- `CONTRACT_MARKERS.md`
- `.review/cycle-51/executor/pass-001-done.json`
- `.review/cycle-51/.read-counter`

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED
