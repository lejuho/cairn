# Codex Review v1

## Verdict
BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Blank-first evidence can render a false `근거` toggle
- Location: `web/src/Today.tsx:729`
- Analysis: `SlotReasonList` computes secondary evidence with `(contrib.evidence ?? []).slice(1).filter(...)`, then renders the primary line as `contrib.evidence[0] ?? contrib.label` (`web/src/Today.tsx:733`). For an evidence array such as `["", "real evidence"]`, the UI renders an empty primary line and a `근거` toggle for `"real evidence"`. That array has only one non-empty evidence line, so the plan says it must render no detail toggle. The same issue applies when the first item is whitespace and later items contain the only real line.
- Impact: The Sprint Contract item "Contributions with one or zero non-empty evidence lines render no detail toggle" is not met, and the missing edge-case candidate for blank/whitespace evidence is only partially covered. Existing tests cover `[]` and blank secondary lines after a real primary line, but not blank/whitespace in the first position.
- Fix direction: Normalize first with `const evidenceLines = (contrib.evidence ?? []).filter((s) => typeof s === "string" && s.trim() !== "")`; render `evidenceLines[0] ?? contrib.label`; derive secondary lines from `evidenceLines.slice(1)`; show the toggle only when that secondary array is non-empty. Add event or task coverage for `["", "real evidence"]` and/or `["   ", "real evidence"]` proving no `근거` toggle appears and the real single evidence line remains visible.

## Sprint Contract Check
- Event multiple-evidence toggle: PASS. Tests cover an event candidate with three evidence lines, collapsed/expanded/collapsed state, and `aria-expanded`.
- Task multiple-evidence toggle: PASS. Tests cover a task candidate with multiple evidence lines through the shared `SlotReasonList`.
- First evidence visible and secondary hidden until expanded: PASS for non-blank primary evidence.
- Zero/one non-empty evidence no-toggle: FAIL. Blank or whitespace primary evidence plus one later non-empty line incorrectly renders a toggle.
- Existing feasibility/friction/people action behavior unchanged: PASS by code inspection and preserved tests; the action controls remain separate from candidate apply buttons.
- Detail toggles do not schedule/apply/dismiss/navigate/fetch: PASS by code inspection and tests; the toggle only updates local React state.
- No backend/shared/db migration/route/service change: PASS. Static enumeration has no `server/` or `shared/` matches.
- No raw annotation drilldown, Mirror data fetch, scoring, external API, LLM, Gmail/GCal/movement/cron, notification draft, or status mutation: PASS. Static negative grep has no matches.
- UI semantic tokens and 44px touch targets: PASS. `.today-slot-evidence-toggle` uses semantic tokens and `min-height: 44px`.
- `docs/codebase-map.md` boundary update: PASS.

## Automatic Checks
- `corepack pnpm lint`: PASS
- `corepack pnpm typecheck`: PASS
- `corepack pnpm test`: PASS
- `corepack pnpm build`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check master...HEAD`: PASS
- `git diff --name-only master...HEAD | rg '^(server|shared)/'`: PASS (no matches)
- `git diff -U0 master...HEAD -- web/src docs | rg -n 'completeChat|LLM_PROXY_BASE_URL|gmail|Gmail|googleapis|fetch\\([^)]*mirror|/api/mirror|movement|scheduler|cron'`: PASS (no matches)

## Changes Outside Plan
None.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY (plan Sprint Contract: "Contributions with one or zero non-empty evidence lines render no detail toggle". A blank/whitespace first item + one real line has exactly one non-empty line, so it must show no toggle. My pass-001 deferral of the find-non-empty normalization — citing "first line exactly as today" — was wrong: the reviewer's fix preserves that for all non-empty evidence[0] and only corrects the degenerate blank-first case.)

### Applied

RESOLVED: ISSUE-1 — Normalize non-empty evidence lines before deciding primary/secondary/toggle.

- `web/src/Today.tsx` `SlotReasonList` (exactly the reviewer's fix direction):
  - `const evidenceLines = (contrib.evidence ?? []).filter((s) => typeof s === "string" && s.trim() !== "");`
  - primary = `evidenceLines[0] ?? contrib.label` (was `contrib.evidence[0] ?? contrib.label`).
  - `const secondary = evidenceLines.slice(1);` (was `evidence.slice(1).filter(non-empty)`).
  - 근거 toggle still gated on `secondary.length > 0` — now correctly counts genuine SECOND non-empty lines only.
- Effect: `["", "real evidence"]` / `["   ", "real evidence"]` → the real line is the visible primary and NO toggle renders (only one non-empty line). For non-empty `evidence[0]` (all real server data) the output is byte-identical to before, so existing event/task evidence tests are unaffected.
- `web/src/Today.test.tsx`: added a task test proving `["", "real"]` and `["   ", "real"]` show the real line as primary and render no `근거` toggle.
- Scope: frontend only (Today.tsx + test). No backend/shared/DB/route/CSS change; toggle still only flips local state (no fetch/schedule/dismiss/nav).

자동 체크: `corepack pnpm verify` ✅ (lint ✅ / typecheck ✅ / web Today 160 ✅ / build ✅) / `git diff --check master...HEAD` ✅ / `git diff --name-only master...HEAD | rg '^(server|shared)/'` → no matches ✅. Committed `75b252a`.
