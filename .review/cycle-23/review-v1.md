# Codex Review v1

## Verdict

BLOCKED

## Findings

### ISSUE-1 [MEDIUM] Shared request schema does not enforce cross-field profile invariants

- Location: `shared/src/people.ts:59`
- Analysis: `UpdatePersonProfileRequestSchema` validates only field shapes. It
  accepts half-empty preferred windows and preferred/unavailable overlap, while
  `shared/src/people-profile.test.ts` explicitly locks in overlap acceptance.
- Impact: The Sprint Contract requires shared schemas to reject half-empty and
  contradictory profile requests. The shared package is not the runtime source
  of truth for the public request contract.
- Fix direction: Add schema-level cross-field refinement for both invariants,
  update shared tests to reject both directions of half-empty input and overlap,
  and keep repository validation only as defense in depth.

### ISSUE-2 [MEDIUM] Legacy hard-constraint route can create a contradictory profile

- Location: `server/src/repositories/people.ts:142`
- Analysis: `replaceHardConstraints` replaces unavailable weekdays without
  checking the person's existing `preferredWindows`. InputHub can therefore
  mark a currently preferred weekday unavailable through the legacy endpoint.
- Impact: The authored profile invariant is enforced only by the new profile
  endpoint, not across existing mutation paths. Stored data can violate the
  Sprint Contract's preferred/unavailable exclusion rule.
- Fix direction: Validate existing preferred windows before the legacy update
  and return typed `400 VALIDATION_ERROR` without mutation on overlap. Add a
  temporary-SQLite integration test proving the old row remains unchanged.

### ISSUE-3 [MEDIUM] Three person-returning repository paths still emit partial rows

- Location: `server/src/repositories/people.ts:231`
- Analysis: `findEventWithPeople`, `replaceEventPeople`, and `findPeopleByIds`
  select only id/name/relation/channel and cast the partial objects to
  `PersonRow`. They bypass `PERSON_COLS` and `mapPersonRow`, omitting
  `hardConstraints`, `preferredWindows`, and `leadTime`.
- Impact: The Sprint Contract requires every person-returning repository path
  to emit one normalized profile shape. Optional shared fields currently hide
  the violation from typecheck and tests.
- Fix direction: Route all three projections through the unified projection and
  mapper. Make the new nullable profile fields required in `PersonRowSchema` if
  compatibility permits, then add event-people and ID-lookup integration
  assertions for the full normalized shape.

### ISSUE-4 [MEDIUM] Profile dialog can disappear while an active save still mutates data

- Location: `web/src/PersonDetail.tsx:115`
- Analysis: The cancel button is disabled while saving, but Escape, backdrop,
  and the close button still call `closeSheet`. The pending PUT continues and
  can refresh/mutate after the editor has disappeared.
- Impact: Dismissal no longer means "without mutation" during the most important
  transition, and UI state can change after apparent cancellation.
- Fix direction: Block every dismissal path while `saving` or cancel the request
  with an `AbortController`. Test Escape, backdrop, and close during an active
  save as well as normal non-mutating dismissal.

### ISSUE-5 [MEDIUM] Bottom-sheet focus management is incomplete

- Location: `web/src/PersonDetail.tsx:299`
- Analysis: Opening focuses the close button, but the modal does not trap focus,
  make background content inert, or restore focus to the profile-edit opener
  after dismissal.
- Impact: Keyboard users can move behind an `aria-modal` dialog and lose their
  position when it closes, missing the Sprint Contract's accessible sheet and
  manual focus-behavior requirements.
- Fix direction: Track the opener, contain Tab/Shift+Tab within the dialog,
  prevent background interaction, restore opener focus on close, and add
  focused component tests.

### ISSUE-6 [LOW] New profile styling violates target-size and semantic-token rules

- Location: `web/src/styles.css:1636`
- Analysis: `.action-btn--sm` sets `min-height: 36px`, below the required 44px.
  `.sheet-error` uses undefined `--warm` with a hardcoded color fallback instead
  of an existing semantic token.
- Impact: The explicit 44px target and semantic-token Sprint Contract checks are
  not met.
- Fix direction: Keep the edit button at least 44px and use/add a semantic error
  token with light/dark values. Verify focus-visible and reduced-motion behavior.

## Sprint Contract Check

- Shared primitive enum/range validation: PASS.
- Shared half-empty/overlap validation: FAIL (ISSUE-1).
- Canonical SQLite JSON round-trip, duplicate ordering, zero, and null clearing:
  PASS.
- Validation/not-found no-write behavior through the new endpoint: PASS.
- Cross-endpoint contradiction prevention: FAIL (ISSUE-2).
- Malformed preferred/lead JSON fail-open: PASS.
- Uniform normalized `PersonRow` projections: FAIL (ISSUE-3).
- Existing tagging, directory stats, recent meetings, and Decision guard:
  PASS in automated regression checks.
- Configured and empty profile display: PASS.
- Save/refetch and failure retention: PASS for covered paths.
- Safe dismissal and accessible focus lifecycle: FAIL (ISSUE-4, ISSUE-5).
- 44px targets and semantic tokens: FAIL (ISSUE-6).
- No LLM dependency: PASS.
- No migration: PASS.
- `docs/codebase-map.md` update: PASS.
- Manual mobile/wide, light/dark, keyboard, and reduced-motion check: NOT RUN.

## Automatic Checks

- `corepack pnpm db:generate`: PASS (no schema changes).
- `corepack pnpm test:integration`: PASS (12 files, 289 tests).
- `corepack pnpm test`: PASS (shared 21, server 7, web 188).
- Independent root/package typechecks: PASS.
- `corepack pnpm build`: PASS, including PWA asset assertion.
- `corepack pnpm verify`: PASS in clean-context reviewer run. A concurrent local
  rerun was interrupted during duplicate server typecheck work and is not used
  as the project result.
- `git diff --check`: PASS.

## Changes Outside Plan

None found.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforced -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY
- ISSUE-4: APPLY
- ISSUE-5: APPLY
- ISSUE-6: APPLY

### Applied

RESOLVED: ISSUE-1 — Schema-level cross-field refinements in UpdatePersonProfileRequestSchema
- Added two `.refine()` calls to shared schema: (1) half-empty check on `preferredPeriods` path, (2) overlap check on `unavailableWeekdays` path
- Updated shared tests to reject both half-empty directions and overlap at schema level
- Repository validation retained as defense in depth
자동 체크: shared typecheck ✅ / shared test (23 tests) ✅ / verify ✅

RESOLVED: ISSUE-2 — Legacy hard-constraints route guards against existing preferred windows
- `replaceHardConstraints` now returns `"conflict"` sentinel when unavailable day overlaps existing `preferredWindows.weekdays`
- Route handles `"conflict"` → 400 VALIDATION_ERROR without mutation; `null` → 404 NOT_FOUND
- 3 new integration tests: overlap rejected, row unchanged after rejection, non-overlapping days allowed
자동 체크: server typecheck ✅ / test:integration (69 tests) ✅ / verify ✅

RESOLVED: ISSUE-3 — Narrow EventPersonRow type for join-path projections
- Added `EventPersonRowSchema` / `EventPersonRow` to shared (id/name/relation/channel only)
- `EventPeopleResponseSchema.people` now uses `EventPersonRowSchema` (no more unsafe PersonRow[] cast)
- `findEventWithPeople`, `replaceEventPeople`, `findPeopleByIds` use `EVENT_PERSON_COLS` + `mapEventPersonRow`, return `EventPersonRow[]`
- Removes all `as PersonRow[]` casts; typecheck now enforces the distinction
자동 체크: server typecheck ✅ / test:integration ✅ / verify ✅

RESOLVED: ISSUE-4 — Block all dismissal paths while saving
- `closeSheet` Escape listener gated on `!sheet.saving`
- Backdrop click gated on `!sheet.saving`  
- 닫기 button gets `disabled={sheet.saving}` and explicit guard
- 취소 button already had `disabled={sheet.saving}`
- New test: 닫기 is disabled and Escape blocked during pending save
자동 체크: web typecheck ✅ / web test (22 tests) ✅ / verify ✅

RESOLVED: ISSUE-5 — Focus trap and opener focus-restore
- Added `openerRef` on the 프로필 편집 button; `closeSheet` calls `requestAnimationFrame(() => openerRef.current?.focus())`
- Sentinel-div approach: start/end `tabIndex=0` divs outside the dialog redirect Tab/Shift+Tab back into the sheet
- `openSheet` continues to focus the close button via `requestAnimationFrame`
- New test: focus restores to opener after close (rAF stubbed synchronous)
자동 체크: web typecheck ✅ / web test ✅ / verify ✅

RESOLVED: ISSUE-6 — 44px target and semantic error token
- `.action-btn--sm` min-height raised from 36px → 44px
- Added `--error` CSS custom property to both dark (`:root`) and light (`@media prefers-color-scheme: light`) themes
- `.sheet-error` now uses `var(--error)` (no fallback hardcoded color); legacy `.sheet-error` also migrated from `--cancelled` to `--error`
자동 체크: web typecheck ✅ / web build ✅ / verify ✅
