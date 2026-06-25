# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Required verify pipeline fails on lint
- 위치: `server/src/services/sequence-order.ts:270`
- 분석: `corepack pnpm verify` stops in `server lint` because `end` is declared with `let` but is never reassigned (`prefer-const`). The standalone server lint check reports the same error.
- 영향: Cycle Completion Criteria require all automatic checks to pass. This branch cannot be accepted while `pnpm verify` exits non-zero.
- 수정 방향: Change `let end` to `const end`, then rerun at least `corepack pnpm --filter @cairn/server lint` and `corepack pnpm verify`.

### ISSUE-2 [HIGH] Soft-only dependencies render an empty ordering section
- 위치: `web/src/Today.tsx:270`
- 분석: `SequenceOrderSection` sets `show=true` when `softEdges.length > 0`, but the rendered body only covers `cycleDetected`, `violations`, `orderChanged`, and `criticalPath`. A day with only soft/tentative dependency evidence renders just the "순서 힌트" heading and no explanation.
- 영향: Sprint Contract says soft/tentative edges remain visible evidence and must not become hidden hard blockers. The current UI surfaces the section but loses the actual soft-edge evidence, so the user sees unexplained empty UI for a valid non-quiet state.
- 수정 방향: Render a compact dependency-evidence line/list for soft/tentative edges, or change the visibility rule only if the plan is amended. Add a Today UI regression test for a soft-only dependency.

### ISSUE-3 [MEDIUM] Critical path drops zero-duration upstream dependencies
- 위치: `server/src/services/sequence-order.ts:257`
- 분석: `longestPath` initializes each node distance to its own duration. When an upstream dependency has `0` duration and the downstream node has positive duration, `cand === cur` and `parent.get(v) == null`, so no parent is recorded. The resulting path can collapse to a single node and then be suppressed at line 286.
- 영향: The plan requires invalid duration to count as `0`, not for the hard-dependency path to disappear. A hard edge such as `A -> B` where `A` has malformed/zero duration should still be able to surface `[A, B]` as the dependency path evidence.
- 수정 방향: On equal distance with no parent, record the deterministic predecessor when it represents a hard edge, then add a pure service regression test for zero/invalid-duration upstream dependencies.

### ISSUE-4 [MEDIUM] UI coverage, styles, and codebase-map update are missing
- 위치: `docs/codebase-map.md:209`
- 분석: Pure service tests and route integration tests now exist, but there are no Today UI tests for `sequenceOrder`, no `.feas-seqorder*` styles in `web/src/styles.css`, and `docs/codebase-map.md` still documents `computeDayFeasibility` only through `sequenceEnergy`.
- 영향: Sprint Contract explicitly requires frontend tests, semantic-token UI styling, and codebase-map updates. Existing UI tests pass because they do not assert the new "순서 힌트" behavior.
- 수정 방향: Add Today UI tests for quiet/violation/candidate/cycle/soft-only rendering; add semantic-token styles for `.feas-seqorder*`; update `docs/codebase-map.md` for `sequenceOrder`, `findEventDependencyLinks`, and the Today "순서 힌트" surface.

## Sprint Contract Check
- `DayFeasibility` requires `sequenceOrder`: PASS in shared schema.
- Every `DayFeasibility` producer returns `sequenceOrder`: PASS by current typecheck and route/service wiring.
- Dependency direction for `requires` and `blocks`: PASS by pure service tests.
- Only hard edges constrain candidate order: PASS by pure service tests.
- Deterministic topological candidate order: PASS by pure service tests.
- Transition-cost tie-break reuses existing model: PASS by pure service tests.
- Current-order violations: PASS by pure service tests.
- Cycle detection fallback: PASS by pure service tests.
- Critical path: FAIL for zero/invalid-duration upstream edge case.
- Today UI read-only "순서 힌트": PARTIAL, implemented for violation/candidate/critical/cycle states but fails soft-only evidence.
- No DB write/LLM/external/apply button: PASS by inspection for current diff.
- Existing energy/gap/continuous/transition/sequence-energy behavior: existing tests PASS.
- Route integration coverage for real SQLite `links`: PASS.
- Today UI test coverage for sequence ordering: FAIL.
- Sequence-order styling: FAIL.
- Codebase map update: FAIL.
- Manual mobile/light/dark/reduced-motion evidence: NOT RUN.

## Automatic Checks
- `git diff --check`: PASS.
- `corepack pnpm db:generate`: PASS.
- `corepack pnpm --filter @cairn/shared test`: PASS.
- `corepack pnpm --filter @cairn/server typecheck`: PASS.
- `corepack pnpm --filter @cairn/server lint`: FAIL (`server/src/services/sequence-order.ts:270 prefer-const`).
- `corepack pnpm --filter @cairn/server test`: PASS.
- `corepack pnpm --filter @cairn/server test -- sequence-order`: PASS.
- `corepack pnpm test:integration`: PASS (573 tests).
- `corepack pnpm --filter @cairn/web test`: PASS.
- `corepack pnpm verify`: FAIL, stops at server lint.

## Changes Outside Plan
- No functional implementation outside the planned shared/server/web/docs areas was found.
- Untracked `.review/cycle-48/.read-counter` exists. If it is hook metadata, exclude or justify it before merge; it is not listed as a planned cycle artifact.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY
- ISSUE-3: APPLY
- ISSUE-4: APPLY

### Applied

RESOLVED: ISSUE-1 — verify pipeline green (prefer-const)
- `server/src/services/sequence-order.ts`: changed `let end` → `const end` (never reassigned). `corepack pnpm --filter @cairn/server lint` and `corepack pnpm verify` now exit 0.

RESOLVED: ISSUE-2 — soft-only dependencies now render evidence, not an empty section
- `web/src/Today.tsx` `SequenceOrderSection`: added a soft/tentative evidence list (`data-testid="seqorder-soft"`/`seqorder-soft-edge`, "참고: X → Y (약한 의존)") so a day with only soft/tentative dependency evidence explains its dependency instead of showing a bare heading. Soft edges remain evidence-only — they never enter `candidateOrder` or violation logic (those are built from `hardEdges` only).
- `web/src/Today.test.tsx`: added a regression test asserting a soft-only `sequenceOrder` renders the soft-edge evidence and shows no candidate/violation copy.
- `web/src/styles.css`: `.feas-seqorder-soft*` semantic-token styles.

RESOLVED: ISSUE-3 — critical path keeps zero/invalid-duration upstream dependencies
- `server/src/services/sequence-order.ts` `longestPath`: on EQUAL distance, still record the deterministic predecessor (lower current rank, then id) so a real hard edge surfaces even when the upstream event has 0/invalid duration. `A(0-duration) → B` now yields `criticalPath [A, B]` instead of collapsing to a single node. `parent` is only ever set inside the hard-adjacency iteration, so a node with no incoming hard edge still yields a length-≤1 path and is suppressed.
- `server/src/services/sequence-order.test.ts`: added a pure-service regression test for a 0/invalid-duration upstream hard dependency.

RESOLVED: ISSUE-4 — UI tests, styles, and codebase-map added
- `web/src/Today.test.tsx`: Today UI tests for quiet (no render), violation, candidate-preview, critical-path, cycle-warning, and soft-only rendering of `sequenceOrder`.
- `web/src/styles.css`: `.feas-seqorder*` semantic-token styles (violation uses moved-warning left border).
- `docs/codebase-map.md`: updated `computeDayFeasibility` (now `…, relations=[], dependencyLinks=[]` → also `sequenceOrder`), added the `sequence-order.ts` service, the `repositories/links.ts` `findEventDependencyLinks` reader, the feasibility/day + preview + today route wiring, the `SequenceOrderSchema` family, and the Today "순서 힌트" surface.

Note on Changes Outside Plan: `.review/cycle-48/.read-counter` is read-tracking hook metadata, not a planned cycle artifact — it is excluded from the commit (left untracked), no functional change.

자동 체크: lint ✅ / typecheck ✅ / test ✅ (shared 298 / server 372 / web 356) / test:integration ✅ (573) / build ✅ / `corepack pnpm verify` EXIT=0 / `git diff --check master..HEAD` clean / db:generate no changes / static no-LLM/external + no-mutation(non-test ordering path) + no-apply-UI **0 hits**
