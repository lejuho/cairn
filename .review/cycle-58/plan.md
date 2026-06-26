# Resume Export File Actions A Implementation Plan

Branch: feature/cycle-58-resume-export-file-actions-a
Skills: frontend-react-pwa

## Summary

Cycle 57 implemented deterministic JSON/Markdown resume export data and preview for completed resume-relevant threads. FR-CV-02 is still not fully useful as an "external format" flow because the user can view the export but cannot directly copy or save it.

This cycle implements the smallest next slice: copy-to-clipboard and client-side file download actions for the already fetched JSON/Markdown export content. It stays frontend-only, reuses the existing `GET /api/threads/:id/resume-export?format=json|markdown` route, and does not add Typst, pcli, a new backend route, schema changes, DB writes, or LLM calls.

## Input/Output Spec

- Input:
  - User is on `/threads/[id]`.
  - Thread detail is completed (`status='done'`), `resume.resumeRelevant === true`, and has saved resume content.
  - User taps `JSON` or `Markdown` export to fetch and preview content, then taps:
    - `복사` to copy the current export content.
    - `파일 저장` to download the current export content as a local file.
- Output:
  - Copy success:
    - Uses `navigator.clipboard.writeText(currentExport.content)`.
    - Shows scoped success feedback near the export controls.
  - Copy failure:
    - If Clipboard API is unavailable or rejects, shows scoped `복사 실패` feedback.
    - Thread page remains usable; no data mutation.
  - Download success:
    - Creates a client-side `Blob` from the current export content.
    - Uses deterministic filename:
      - `cairn-thread-<id>-resume.json` for JSON.
      - `cairn-thread-<id>-resume.md` for Markdown.
    - Uses MIME:
      - `application/json;charset=utf-8`
      - `text/markdown;charset=utf-8`
    - Revokes any generated object URL after click.
    - Shows scoped success feedback.
  - Download failure:
    - If URL/blob/link creation fails, shows scoped `파일 저장 실패`.
  - Ineligible state:
    - No copy/download actions render before an export preview is ready.

## Key Changes

- Frontend:
  - Extend `ResumeSection` in `web/src/Thread.tsx`.
  - Keep existing JSON/Markdown fetch buttons and preview behavior.
  - Add copy and download controls only when `exportState.tag === "ready"`.
  - Add scoped action feedback state for copy/download success/failure.
  - Implement a small deterministic filename/MIME helper local to the thread export UI.
  - Reuse semantic tokens and existing 44px button class or equivalent 44px touch-target styling.
  - Keep preview as text-only `<pre>`; never render export content as HTML.
- Tests:
  - Extend `web/src/Thread.test.tsx` with copy success/failure and download behavior tests.
  - Mock `navigator.clipboard.writeText`, `URL.createObjectURL`, `URL.revokeObjectURL`, and anchor click behavior without writing real files.
  - Verify no copy/download controls before preview is ready.
  - Verify filename and MIME per format.
- Docs:
  - Update `docs/codebase-map.md` to record the new frontend-only export actions and boundaries.

## Sprint Contract

- Passing criteria:
  - Resume export preview still works for JSON and Markdown exactly as in cycle 57.
  - Copy/download controls render only after an export payload is ready.
  - Copy writes exactly the current `data.content` to the Clipboard API.
  - Copy failure is scoped and non-fatal when clipboard is unavailable or rejects.
  - Download generates a local file from current `data.content` with deterministic extension/MIME for the selected format.
  - Object URLs are revoked after triggering download.
  - No backend route, shared schema, DB schema, migration, LLM gateway, Typst, pcli, score, apply, or resume mutation is introduced.
  - UI remains mobile-first, semantic-token based, keyboard focusable, and 44px touch-target compliant.
  - `docs/codebase-map.md` reflects the new UI behavior.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
- Test cases:
  - Frontend component tests:
    - copy/download controls hidden before export preview.
    - JSON preview then copy success calls clipboard with JSON content and shows success feedback.
    - Markdown preview then copy success calls clipboard with Markdown content.
    - clipboard unavailable/rejecting shows scoped copy failure.
    - JSON download creates Blob with `application/json;charset=utf-8`, filename `cairn-thread-<id>-resume.json`, clicks an anchor, and revokes URL.
    - Markdown download creates Blob with `text/markdown;charset=utf-8`, filename `cairn-thread-<id>-resume.md`, clicks an anchor, and revokes URL.
    - download exception shows scoped file-save failure.
    - no POST/PATCH is fired by copy/download actions.
  - Negative scope checks:
    - `rg "typst|pcli|score|apply|resume-export.*POST|PATCH .*resume-export" web/src shared/src server/src`
    - Expect no new Typst/pcli/score/apply/backend mutation behavior.
  - Manual UI checks:
    - mobile and wide layout for new action controls.
    - light and dark themes.
    - reduced-motion.
    - keyboard focus and Enter/Space activation.
    - touch targets at least 44px.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Clipboard permission may be denied or unavailable in some mobile/PWA contexts; failure must be scoped and non-destructive.
- Browser download APIs may be partially unavailable in PWA/iOS contexts; failure should not erase the preview or block copy.
- User may switch from JSON to Markdown after seeing a preview; copy/download must always use the current ready export, not stale prior content.

## Simpler Alternative

Add only copy-to-clipboard and skip file download. This would be smaller, but FR-CV-02 says export to external formats; a client-side `.md`/`.json` file action is the lowest-risk way to make the current export artifact portable without adding Typst/pcli or backend file generation.

## Assumptions

- Cycle 57's export route and response contract remain the source of truth for content generation and eligibility.
- Browser Blob/object URL download is acceptable for this A-slice because no server-side persistence or object storage exists.
- Filename uses only thread id, not user text, to avoid filename sanitization and path-injection issues.
- Copy/download actions are explicit user actions and do not mutate Cairn decisions or resume data.
- Typst and pcli integration remain later FR-CV-02 slices.

## Review Guidance

### Enumeration needed

- Resume export UI and tests:
  - Search: `rg "resume-export|ThreadResumeExport|clipboard|createObjectURL|download" web/src/Thread.tsx web/src/Thread.test.tsx web/src/styles.css`
  - Expected: new copy/download controls are scoped to `ResumeSection` and only render after `exportState.tag === "ready"`.
- Backend/shared boundary:
  - Search: `rg "resume-export|ThreadResumeExport|PatchThreadResume|ThreadResumeExportDataSchema" shared/src server/src`
  - Expected: no backend route/schema/DB changes are needed; existing export route remains read-only.
- Out-of-scope behavior:
  - Search: `rg "typst|pcli|score|apply|autoApply|resume-export.*POST|PATCH .*resume-export" web/src shared/src server/src`
  - Expected: no Typst/pcli, score/apply, auto-apply, or backend mutation behavior.
- Browser file API cleanup:
  - Search: `rg "createObjectURL|revokeObjectURL|Blob|download" web/src/Thread.tsx web/src/Thread.test.tsx`
  - Expected: every created object URL is revoked, tests cover URL creation/revocation and anchor click.

### Verification guidance

- Frontend behavior:
  - Component tests with mocked API, clipboard, Blob URL, and anchor click are sufficient for automated verification of copy/download behavior.
  - Tests must assert no copy/download controls before a preview exists and no POST/PATCH on copy/download.
- Accessibility/mobile:
  - Automated tests should cover native button focus and activation for the new actions.
  - Manual checks remain required for mobile/wide layout, light/dark appearance, reduced-motion, and physical touch comfort.
- Scope creep:
  - Reviewer should block the cycle if it adds server-side file generation, persistent export files, Typst/pcli, resume auto-apply, scoring, or any extra schema/migration not required for frontend copy/download actions.
