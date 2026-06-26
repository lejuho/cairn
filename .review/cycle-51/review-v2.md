# Codex Review v2

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Out-of-scope workflow changes still remain in the working tree
- Location: AGENTS.md:250
- Location: AGENTS.md:299
- Location: .claude/CLAUDE.md:87
- Location: .claude/settings.json:66
- Analysis: The committed `master..HEAD` diff now contains the Thread Draft A implementation and cycle artifacts, but the working tree still has uncommitted workflow/source-of-truth changes from v1: `AGENTS.md`, `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/check-marker-sync.sh`, `CONTRACT_MARKERS.md`, plus `.claude/hooks/write-executor-done.sh`. These are still outside the cycle-51 plan.
- Impact: The cycle cannot be considered ready to merge from a dirty working tree containing unrelated workflow changes.
- Fix direction: Remove these workflow changes from this cycle or move them to a separate explicitly approved workflow cycle.

### ISSUE-2 [HIGH] Placeholder unknown text can still be persisted as factual draft data
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
- Analysis: The nullable text fields remain plain `z.string().nullable().optional()`, and the service persists them directly. Date placeholders are rejected, but placeholders in textual unknown fields such as `kind: "TBD"`, `location: "unknown"`, or `context: "?"` still pass schema validation and can be stored as durable facts.
- Impact: `FR-THR-03` remains unmet for non-date unknowns.
- Fix direction: Add a reusable draft nullable-text schema that trims and rejects or normalizes placeholder-only unknowns, then test both schema and DB persistence paths.

### ISSUE-3 [MEDIUM] `timeZone` still accepts arbitrary non-empty strings
- Location: shared/src/threadDraft.ts:17
- Analysis: `timeZone` remains `z.string().min(1).optional()`. The request contract says it should be an IANA timezone string.
- Impact: Invalid timezone values can still be passed into the parser prompt.
- Fix direction: Validate with a small IANA timezone helper, for example by constructing `Intl.DateTimeFormat(undefined, { timeZone })`, and add positive/negative schema tests.

## Previous Issue Status
- ISSUE-1: UNRESOLVED
- ISSUE-2: UNRESOLVED
- ISSUE-3: UNRESOLVED

## Regression Check
- No new Thread Draft implementation regression found in the committed feature diff.
- Process note: `.review/cycle-51/executor/pass-002-done.json` exists, but `review-v1.md` still has no RESOLVED content appended. That does not change the technical findings, but the normal BLOCKED-fix flow is incomplete.

## Sprint Contract Check
- `POST /api/threads/draft` creates a persisted draft thread with nodes/links: PASS.
- All created dependency links are `soft/inferred`: PASS.
- Draft events/tasks attach to the created thread: PASS.
- Unknown values remain empty/null and visible as warnings/input-needed copy: BLOCKED by ISSUE-2.
- Invalid LLM output, dangling links, invalid dates/enums, and gateway failures produce no partial DB writes: PASS for covered date/enum/link/gateway paths; non-date placeholders remain uncovered.
- Existing manual `POST /api/threads` and `/threads/new` manual create flow remain stable: PASS by tests.
- Today, slot, feasibility, decision, watcher, and mirror behavior unchanged: PASS for committed implementation; dirty workflow changes remain outside plan.
- `docs/codebase-map.md` reflects the new Thread Draft boundary: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS
  - No schema changes, nothing to migrate.
- `git diff --check`: PASS
- `git diff --check master..HEAD`: PASS
- `corepack pnpm --filter @cairn/shared test -- src/threadDraft.test.ts`: PASS
  - Command ran the shared test suite: 15 files, 342 tests passed.
- `corepack pnpm --filter @cairn/server test -- src/llm/threadDraftParser.test.ts`: PASS
  - Command ran the server unit suite: 29 files, 390 tests passed.
- Prior v1 full check remains relevant for the committed implementation:
  - `corepack pnpm verify`: PASS
  - Integration: 28 files, 596 tests passed.

## Changes Outside Plan
Still present in the working tree:
- `.claude/CLAUDE.md`
- `.claude/hooks/check-marker-sync.sh`
- `.claude/hooks/write-executor-done.sh`
- `.claude/settings.json`
- `AGENTS.md`
- `CONTRACT_MARKERS.md`
- `.review/cycle-51/executor/pass-001-done.json`
- `.review/cycle-51/executor/pass-002-done.json`
- `.review/cycle-51/.read-counter`

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: DEFER (이유: cycle-51 plan scope 밖의 user-owned Hermes workflow/hook 툴링. cycle-51이 authored하지 않았고 commit에서 이미 제외됨. `write-executor-done.sh`는 본 task의 done-file 마커가 의존하는 live 인프라라 discard하면 실행 중 파이프라인이 깨짐. 별도의 명시적 workflow cycle 소관 — cycle-51은 commit도 discard도 하지 않고 그대로 둔다.)
- ISSUE-2: APPLY
- ISSUE-3: APPLY

### Applied

RESOLVED: ISSUE-2 — placeholder unknown text is normalized to NULL, never stored as fact
- `shared/src/threadDraft.ts`: added `DraftNullableText` = `z.string().nullable().optional().transform(v → trim; empty 또는 placeholder 토큰(?, --, n/a, tbd, tba, unknown, none, null, 미정, 모름, 없음, 추후, … case-insensitive) → null; 그 외 trimmed)`. Applied to the nullable text fields `thread.kind`, `thread.goal`, `event.type`, `event.location`, `task.context`. Date fields were already rejected at schema. Normalization happens at parse time so the service inserts normalized nulls; only text fields are touched, so no node is dropped and links never dangle.
- `shared/src/threadDraft.test.ts`: placeholder/empty → null, and a real value is trimmed (not nulled).
- `server/src/routes/thread-draft.integration.test.ts`: asserts the DB rows persist NULL for placeholder `kind`/`goal`/`type`/`location`/`context`, and the response mirrors the nulls. FR-THR-03 now holds for non-date unknowns.

RESOLVED: ISSUE-3 — timeZone is validated as a real IANA zone
- `shared/src/threadDraft.ts`: `timeZone` now `z.string().min(1).refine(isIanaTimeZone).optional()`, where `isIanaTimeZone(tz)` constructs `new Intl.DateTimeFormat("en-US", { timeZone: tz })` (throws RangeError on an unknown zone).
- `shared/src/threadDraft.test.ts`: accepts `America/New_York`; rejects `Mars/Olympus`, `not-a-zone`, `UTC+9`.

### Process note (Regression Check)
- review-v1.md was superseded by review-v2 before a RESOLVED pass ran; v1's findings carried forward as v2 ISSUE-1/2/3 and are addressed here. RESOLVED is appended to the current review (v2) per instruction.

자동 체크: `corepack pnpm verify` EXIT=0 (shared 17 threadDraft / server unit / integration 10 thread-draft / web; 전체 597) ✅ / `corepack pnpm db:generate` no schema changes ✅ / `git diff --check master..HEAD` clean ✅ / scan(no hard/authored in production, soft/inferred forced) ✅
