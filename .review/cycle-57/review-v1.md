# Codex Review v1

## Verdict
BLOCKED

## Findings

### ISSUE-1 [HIGH] Non-integer route ids are accepted by `parseInt`
- 위치: `server/src/routes/threads.ts:156`
- 분석: The route validates `id` with `parseInt(..., 10)` and then checks only finite/positive. Inputs like `/api/threads/1abc/resume-export?format=json` parse to `1`, so the handler can export thread `1` instead of rejecting the invalid path parameter.
- 영향: Violates the Input/Output Spec requirement that `id` is a positive integer and that invalid path params return `400 VALIDATION_ERROR`. This also weakens the backend skill rule that routes parse external input before service calls.
- 수정 방향: Replace `parseInt` with strict param validation. For example, validate the raw string with a positive-integer regex or a strict zod param schema, then convert to `Number` and require `Number.isSafeInteger(id) && id > 0`. Add an integration test for `1abc`, `1.5`, and similar malformed ids.

### ISSUE-2 [MEDIUM] Export response schema does not encode the format-specific `json` contract
- 위치: `shared/src/threads.ts:329`
- 분석: `ThreadResumeExportDataSchema` makes `json` globally optional, regardless of `format`. It accepts a JSON export without structured `json`, and it also accepts a Markdown export carrying a `json` object. The current service happens to emit the intended shape, but the shared runtime contract does not enforce it.
- 영향: Violates the plan's output spec: `data.json` must be present when `format=json` and absent for Markdown. This leaves clients and future route tests unable to rely on the shared schema as the source of truth.
- 수정 방향: Change the schema to a discriminated union on `format` or add equivalent refinement: JSON branch requires `json: ThreadResumeExportJsonSchema`; Markdown branch rejects `json`. Add shared tests for both invalid combinations.

### ISSUE-3 [LOW] Manual UI checks are not evidenced
- 위치: `.review/cycle-57/executor/pass-001-done.json:8`
- 분석: The executor recorded automated checks and scans, but there is no evidence of the manual UI checks required by the Sprint Contract: mobile and wide layout, light/dark themes, reduced motion, keyboard focus, and 44px tap targets.
- 영향: Sprint Contract manual verification is incomplete for the new PWA export controls.
- 수정 방향: Run and document the manual UI checks in the RESOLVED response. If the user performs the checks directly, record that approval explicitly before merge.

## Sprint Contract Check

- Completed resume-relevant threads export deterministic JSON and Markdown: PASS by service tests and integration tests.
- Non-completed threads cannot export: PASS by `THREAD_NOT_DONE` integration coverage.
- Threads not marked `resumeRelevant=true` cannot export: PASS by `RESUME_NOT_MARKED` integration coverage.
- Empty resume data is rejected: PASS by `RESUME_EMPTY` integration coverage, including blank skills.
- Export uses saved thread resume fields only, no LLM, no DB mutation, no annotation scraping, no fabricated STAR fields: PASS by code inspection and read-only integration snapshot.
- Frontend export UI appears only in completed-thread resume context and remains tap-driven: PASS by component tests.
- Shared runtime schema matches route response contract: FAIL, see ISSUE-2.
- Route validates external input as specified: FAIL, see ISSUE-1.
- Manual UI checks: NOT VERIFIED, see ISSUE-3.
- `docs/codebase-map.md` reflects new route/service/schema/UI: PASS.

## Automatic Checks

- `git diff --check master...HEAD`: PASS
- `corepack pnpm lint`: PASS
- `corepack pnpm typecheck`: PASS
- `corepack pnpm test`: PASS (also observed inside `corepack pnpm verify`; shared 382, server 429, web 400 tests)
- `corepack pnpm test:integration`: PASS (server integration 634 tests)
- `corepack pnpm build`: PASS
- `corepack pnpm verify`: PASS

## Changes Outside Plan

No scope creep found. The implementation stays within shared schemas, thread export service/route, frontend resume export preview, focused tests, advisor feedback, executor marker, and `docs/codebase-map.md`.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY (code-level evidence documented; live visual checks recorded as requiring explicit user sign-off — cannot be performed in a headless executor)

### Applied

RESOLVED: ISSUE-1 — strict positive-integer path param on the export route
- `server/src/routes/threads.ts`: added `parsePositiveIntParam(raw)` (`/^\d+$/` then `Number.isSafeInteger(n) && n > 0`, else `null`). The export route now uses it instead of `parseInt`, so `1abc`/`1.5`/`1e2`/` 1`/`0x1`/`-1` return `400 VALIDATION_ERROR` before any service call.
- `server/src/routes/thread-resume-export.integration.test.ts`: added a test asserting `400 VALIDATION_ERROR` for all of those malformed ids.
- Scope: only the cycle-57 export route changed; the pre-existing `parseInt` in cycle-50/56 routes is out of this cycle's scope and left untouched.

RESOLVED: ISSUE-2 — export response schema now encodes the format-specific `json` contract
- `shared/src/threads.ts`: `ThreadResumeExportDataSchema` is now `z.discriminatedUnion("format", [...])`. The `json` branch (`.strict`) requires `json: ThreadResumeExportJsonSchema`; the `markdown` branch (`.strict`) has no `json` key, so a Markdown payload carrying `json` is rejected and a JSON payload missing `json` is rejected.
- `shared/src/threads.test.ts`: added tests — json-without-json fails, markdown-with-json fails, both correct shapes pass.
- The service already emits json only for the json format; the unit test was narrowed (`if (out.format !== "json") throw` / `"json" in out`). The frontend reads only `.content`/`.warnings`, so no consumer breaks.

RESOLVED: ISSUE-3 — manual UI check evidence (code-level) + pending user sign-off
- Code-level evidence for the export controls: tap targets use `.thread-node-save-btn` (CSS `min-height: 44px`); the export section/preview/error use semantic tokens (`var(--border)`, `var(--moved)`, `var(--accent)`, `var(--raised)`) so light/dark adapt; NO `transition`/`animation`/`transform` was added (reduced-motion safe — the diff confirms none); the JSON/Markdown triggers are native `<button>` elements (keyboard focusable, Enter/Space activatable); the resume section is `width: min(100%, 480px)` single-column (mobile-first).
- The preview renders export `content` inside a `<pre>` as text (no `dangerouslySetInnerHTML`), so user-entered Markdown/HTML is not executed.
- Live interactive visual checks (rendered mobile vs wide, light vs dark appearance, on-device focus walk) cannot be performed in a headless executor; these are recorded as requiring explicit user sign-off before merge.

자동 체크: `corepack pnpm verify` EXIT=0 (635 tests, was 634) ✅ / `corepack pnpm db:generate` no schema changes ✅ / `git diff --check master..HEAD` clean ✅
