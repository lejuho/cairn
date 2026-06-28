# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Pin form test leaves unconditional debug output in committed suite
- Location: `web/src/Today.test.tsx:3935`
- Analysis: The invalid-duration test includes `console.log(...)` and `screen.debug(...)` after submitting the pin form. These are unconditional diagnostic calls in the committed test body, not assertions.
- Impact: This pollutes `corepack pnpm verify` output for a high-volume frontend test and can trip the cycle output hooks during implementation verification. The Sprint Contract requires repeatable automatic checks; committed debug output makes the check noisy even though the assertions pass.
- Fix direction: Remove the unconditional `console.log` and `screen.debug` lines. Keep the scoped error assertion and the no-PUT assertion.

### ISSUE-2 [LOW] Pin error text uses an undefined semantic token
- Location: `web/src/styles.css:1841`
- Analysis: `.feas-pin-error` sets `color: var(--conflict)`, but `--conflict` is not defined in `web/src/styles.css` or the design-system token list. The declaration is invalid at runtime, so the scoped error can inherit ordinary text color instead of a deliberate error/negative tone.
- Impact: This violates the frontend Sprint Contract's semantic-token-only style requirement and weakens the scoped error state for the new pinned duration form.
- Fix direction: Use an existing defined semantic token, preferably `var(--cancelled)` for an error/negative state, or add a deliberate token in the design-system layer only if that broader token addition is intentionally in scope.

## Sprint Contract Check
- `pinned_transit_facts` exists with additive migration only: PASS.
- Pinned facts are user-authored/manual and provenance-labeled in API/UI: PASS.
- Upsert route derives pair identity from DB events and resolved geocode cache rows; browser coordinates are rejected: PASS.
- Missing event, missing location, unresolved geocode, invalid duration, and too-long note fail with typed errors and no DB write: PASS.
- Day feasibility and Today use pinned facts before provider travel cache/provider calls for matching pairs: PASS.
- Pinned facts contribute to gap required minutes via `travelMargin` with `gap_travel_pinned_included`: PASS.
- Preview endpoint reads pinned facts but remains write-free: PASS.
- No Naver API/scraping/provider credential, cron/bulk enrichment, automatic rescheduling, or LLM path was introduced: PASS.
- Existing deterministic transition cost and sequence energy semantics remain valid: PASS.
- Today UI offers add/update pinned duration without breaking existing states/actions: PARTIAL. Behavior is covered, but the new scoped error style uses an undefined token.
- `docs/codebase-map.md` reflects the new table/route/service/travel/UI boundary: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS (`No schema changes, nothing to migrate`).
- `corepack pnpm verify`: PASS when stdout/stderr were redirected to `/tmp/cairn-cycle78-verify.log` to avoid hook noise from frontend test diagnostics.
  - lint: PASS.
  - typecheck: PASS.
  - unit tests: PASS (`shared` 445, `server` 519, `web` 521).
  - integration tests: PASS (`server` 749).
  - production build: PASS.
- `corepack pnpm --filter @cairn/web exec vitest run --reporter=json --outputFile=/tmp/cairn-vitest-web.json`: PASS (`web` 521).
- `git diff --check master...HEAD`: PASS.
- Static negative checks:
  - No implementation Naver API/scraping/provider credential path: PASS. Matches were negative docs/tests only.
  - No automatic schedule mutation: PASS.
  - Pinned route request body does not accept browser coordinates: PASS. Coordinate fields in the diff are response/storage/service-derived fields and negative tests.
  - No LLM path: PASS.

## Changes Outside Plan
None in the Cycle 78 branch diff. Unrelated uncommitted dotfile/config changes and older cycle artifacts remain in the working tree and were not included in this review.

<!-- RESOLVED-BOUNDARY · above=Codex immutable, below=Executor append-only · check-resolved-immutable.sh enforces -->

## RESOLVED (Executor response, append at file end)
