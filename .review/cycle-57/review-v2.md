# Codex Review v2

## Verdict
BLOCKED

## Findings

### ISSUE-3 [LOW] Live manual UI checks still require explicit sign-off
- 위치: `.review/cycle-57/review-v1.md:69`
- 분석: The RESOLVED section documents useful code-level evidence for tap target size, semantic tokens, reduced-motion safety, native buttons, text-only preview rendering, and single-column layout. That closes the code-inspection portion. It does not close the Sprint Contract's live/manual checks: rendered mobile vs wide layout, light vs dark appearance, reduced-motion behavior in the actual UI, keyboard focus walk, and touch target verification.
- 영향: The Sprint Contract still has a manual verification item pending before merge. This is not a code defect, but it is an explicit completion criterion.
- 수정 방향: User or executor must perform the manual UI checks and record explicit approval in the cycle artifact before merge. If the user performs the check, append a short RESOLVED note below this review's boundary stating the approval and checked surfaces.

## Previous Issue Status

- ISSUE-1: RESOLVED
- ISSUE-2: RESOLVED
- ISSUE-3: UNRESOLVED

## Regression Check

No new code regression found.

- ISSUE-1 fix is scoped to the cycle-57 export route and now rejects malformed ids like `1abc`, `1.5`, exponent, whitespace, hex, zero, and negative values before service calls.
- ISSUE-2 fix uses a discriminated union on `format`, requiring `json` for JSON exports and rejecting `json` on Markdown exports. Existing service output conforms and frontend reads only `content`/`warnings`.
- Export remains read-only and deterministic. No LLM gateway dependency, DB mutation, annotation scraping, Typst, pcli, download, score, or apply behavior was introduced.

## Sprint Contract Check

- Completed resume-relevant threads export deterministic JSON and Markdown: PASS.
- Non-completed threads cannot export: PASS.
- Threads not marked `resumeRelevant=true` cannot export: PASS.
- Empty resume data is rejected: PASS.
- Export uses saved thread resume fields only; no LLM, DB mutation, annotation scraping, or fabricated STAR fields: PASS.
- Frontend export UI appears only in completed-thread resume context and remains tap-driven: PASS.
- Route validates external input as specified: PASS.
- Shared runtime schema matches route response contract: PASS.
- `docs/codebase-map.md` reflects new route/service/schema/UI: PASS.
- Manual UI checks: BLOCKED pending explicit live/user sign-off.

## Automatic Checks

- `git diff --check master...HEAD`: PASS
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - unit tests: PASS (`shared` 383, `server` 429, `web` 400)
  - integration tests: PASS (`server` 635)
  - build/PWA build assertion: PASS

## Changes Outside Plan

No scope creep found. Review-v1 fixes stayed within the export route validation, export response schema/tests, and cycle review artifacts.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

### Issue Classification
- ISSUE-3: APPLY (automatable portion closed with new tests; irreducibly-visual live checks deferred to explicit user sign-off — a headless executor cannot render or visually approve)

### Applied

RESOLVED: ISSUE-3 — manual UI checks: automatable evidence added; live visual checks pending user sign-off
- `web/src/Thread.test.tsx`: added two automated accessibility tests for the export controls that convert the keyboard-focus, keyboard-activation, and tap-target portions of the manual checklist into automated evidence:
  - both `resume-export-json-btn` / `resume-export-md-btn` are native `<button>` elements (keyboard-activatable by default), carry the `.thread-node-save-btn` class (CSS `min-height: 44px` tap target), and pass `.focus()` → `toHaveFocus()`.
  - focusing the JSON button and activating it fetches the export and renders the `resume-export-preview`.
- Code-level evidence (restated, all verifiable in the diff/CSS): semantic tokens (`var(--border)`, `var(--moved)`, `var(--accent)`, `var(--raised)`) drive light/dark; NO `transition`/`animation`/`transform` was added (reduced-motion safe); the preview is `<pre>` text only (no `dangerouslySetInnerHTML`); the resume section is `width: min(100%, 480px)` single-column.

UNRESOLVED (requires user action — outside executor capability):
The following are irreducibly-visual, live checks that a headless executor cannot render or approve. They are recorded here as a checklist for explicit **user sign-off before merge**:
- [ ] Rendered mobile vs wide layout of the export controls + preview.
- [ ] Light vs dark theme appearance of the export section.
- [ ] Reduced-motion behavior in the actual running UI.
- [ ] On-device keyboard focus walk across the JSON/Markdown buttons.
- [ ] Physical touch-target comfort (≥44px) on a real device.

Rationale for not closing these in-code: per the Implementation/skill contract these are live visual verifications; fabricating an approval the executor did not perform would be dishonest. The automatable slice is now covered by tests; the visual slice needs a human.

자동 체크: `corepack pnpm verify` EXIT=0 (635 tests) ✅ / `git diff --check master..HEAD` clean ✅
