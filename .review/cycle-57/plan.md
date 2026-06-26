# Thread Resume Export A Implementation Plan

Branch: feature/cycle-57-thread-resume-export-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 55 added ephemeral STAR draft generation and cycle 56 added completed-thread resume save/edit fields. The remaining CV spec now needs a deterministic export path. This cycle implements the first slice of FR-CV-02: export a user-confirmed completed thread resume as JSON or Markdown.

The export is read-only. It uses only saved thread resume fields, never calls the LLM gateway, never scrapes annotations at export time, and does not add Typst, pcli, download files, scoring, or apply-to-resume behavior.

## Input/Output Spec

- Input:
  - `GET /api/threads/:id/resume-export?format=json|markdown`
  - `id`: positive integer thread id.
  - `format`: required export format enum, `json` or `markdown`.
- Output:
  - Success:
    - `200 { ok: true, data }`
    - `data.format`: `json | markdown`
    - `data.content`: deterministic export text.
    - `data.json`: structured export object when `format=json`; absent for Markdown.
    - `data.warnings`: deterministic warnings, for example when task text is represented by the thread goal because Cairn does not persist `star_task`.
  - Failure:
    - `400 VALIDATION_ERROR` for invalid path params or query format.
    - `404 NOT_FOUND` when the thread does not exist.
    - `409 THREAD_NOT_DONE` when the thread is not completed.
    - `409 RESUME_NOT_MARKED` when `resumeRelevant` is not true.
    - `409 RESUME_EMPTY` when the thread is marked relevant but has no saved STAR fields or skills.

## Key Changes

- Shared:
  - Add runtime schemas and TypeScript types for resume export format, structured export payload, and route response.
  - Keep stored resume enum/string conventions unchanged; do not add `star_task`.
- Backend:
  - Add a deterministic thread resume export service that formats saved thread resume fields into JSON and Markdown.
  - Add `GET /api/threads/:id/resume-export` under the existing thread route boundary.
  - Reuse existing thread/resume reads and return stable typed errors for not found, not done, not marked, and empty export cases.
  - Prove the route performs no database writes and does not reach the LLM gateway.
- Frontend:
  - Add completed-thread resume export controls to the existing completed-thread resume section.
  - Show controls only when the thread is completed and has saved resume data marked as resume-relevant.
  - Fetch export content only on user tap, then render a scoped JSON/Markdown preview.
  - Show scoped loading and error states without blocking the rest of the thread page.
  - Do not add Typst, pcli, download, score, or apply buttons in this cycle.
- Docs:
  - Update `docs/codebase-map.md` with the new route, schemas, service, and UI entry point.

## Sprint Contract

- Passing criteria:
  - Completed resume-relevant threads with saved resume content can export deterministic JSON and Markdown.
  - Non-completed threads cannot export resume content.
  - Threads not explicitly marked `resumeRelevant=true` cannot export resume content.
  - Empty resume data is rejected with a stable error instead of exporting a misleading blank artifact.
  - Export uses saved thread resume fields only; it does not call the LLM gateway, mutate the DB, scrape annotations, or fabricate missing STAR fields.
  - Frontend export UI appears only in the completed-thread resume context and remains tap-driven.
  - `docs/codebase-map.md` reflects the new route and frontend surface.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
- Test cases:
  - Shared schema tests for accepted/rejected export formats and response payloads.
  - Backend unit tests for JSON and Markdown formatting, including empty optional fields and deterministic warnings.
  - Backend SQLite integration tests for success, invalid format, unknown thread, not done, not marked, empty resume, and read-only behavior.
  - Frontend tests for hidden export controls on ineligible threads, visible controls on eligible completed threads, tap-to-fetch JSON/Markdown previews, scoped loading, and scoped error handling.
  - Manual UI checks: mobile and wide layout, light and dark themes, reduced motion, keyboard focus, and 44px tap targets for the export controls.
  - Negative scope checks: no Typst/pcli/download/apply/score UI and no LLM gateway calls from export.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- `skillsTags` may contain duplicate, blank, or unusual punctuation entries from earlier user edits; export should normalize display safely without mutating stored data.
- A thread may be marked resume-relevant before any STAR field is saved; export must reject it as empty rather than implying a useful CV artifact exists.
- Markdown content may contain user-entered Markdown characters; export should preserve text predictably without executing or rendering unsafe HTML in the preview.

## Simpler Alternative

Render a client-only Markdown block from already loaded thread detail data and skip a backend export route. This is faster, but it would duplicate export rules in the client, provide no stable API contract for future Typst/pcli export, and make read-only/no-LLM behavior harder to verify centrally. The backend route is the better first boundary.

## Assumptions

- Cycle 56 resume fields are the source of truth: `resumeRelevant`, `starSituation`, `starAction`, `starResult`, and `skillsTags`.
- Cairn intentionally does not persist `star_task`; JSON/Markdown may include thread `goal` as contextual task/goal metadata with a warning, but must not pretend it is a saved STAR Task field.
- `done` is the persisted completed thread status value.
- Export eligibility requires explicit user confirmation through `resumeRelevant=true`.
- Typst and pcli integration remain future FR-CV-02 slices.

## Review Guidance

### Enumeration needed

- Existing thread route registration and route tests:
  - Search: `rg "threads/:id|resume-export|star-draft|resume" server/src server/test shared/src`
  - Expected: new export route is registered under the same thread API boundary and has focused integration coverage.
- Existing resume schemas and types:
  - Search: `rg "ThreadResume|PatchThreadResume|resumeRelevant|starSituation|skillsTags" shared/src server/src web/src`
  - Expected: export schemas extend the existing resume contract without changing stored field names or adding `star_task`.
- Existing frontend thread resume surface:
  - Search: `rg "ResumeSection|StarDraftSection|star-save-to-resume|resumeRelevant|starResult" web/src`
  - Expected: export UI is scoped to the completed-thread resume area and does not appear on active/non-relevant threads.
- LLM gateway boundaries:
  - Search: `rg "llm|gateway|chat/completions|star-draft" server/src web/src`
  - Expected: export implementation does not import or call the LLM gateway.
- Out-of-scope export affordances:
  - Search: `rg "typst|pcli|download|score|apply" shared/src server/src web/src`
  - Expected: no new Typst/pcli/download/score/apply behavior introduced by this cycle.

### Verification guidance

- Route input validation:
  - Mock-only tests are insufficient for route eligibility because status and resume data live in SQLite.
  - Use Fastify route integration tests with a real temporary SQLite database.
- Deterministic formatting:
  - Pure unit tests are sufficient for JSON/Markdown builder output if all inputs are explicit value objects.
  - Include snapshots or exact string assertions for ordering and warnings.
- DB read-only behavior:
  - Integration test should compare relevant table rows or `updatedAt` values before/after export.
  - Export must not run migrations or create files.
- Frontend behavior:
  - Component/page tests with mocked API responses are sufficient for visibility, tap-to-fetch, preview, loading, and scoped error states.
  - Manual visual checks remain required for mobile/light/dark/reduced-motion/touch-target coverage.
- Scope creep:
  - Reviewer should fail the cycle if it adds Typst/pcli integration, download files, annotation scraping at export time, or any LLM gateway dependency.
