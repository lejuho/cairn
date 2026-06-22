# Step 001 — Approach check: cycle-31 Feasibility Params UI

Cycle: 31
Pass: 2
Files Changed: (none yet — approach check before implementation)
Planned: shared/src/feasibility.ts, server/src/services/feasibility-params.ts, server/src/routes/feasibility.ts, web Today.tsx, + tests

## Advisor Verdict
PASS

## Advisor Feedback
All assumptions verified. The approach is sound and matches codebase conventions.

Refined approach notes:

- Atomic write — confirmed sound. `CairnDatabase = BetterSQLite3Database<typeof schema>`, and the repo already defines `CairnDbExecutor` (union of db + `BetterSQLiteTransaction`) precisely so repo helpers can run inside transactions. Use `db.transaction((tx) => { upsertParam(tx, ...) ×5 })`. Note: `upsertParam` currently types its param as `CairnDatabase`, not `CairnDbExecutor` — the tx handle is structurally compatible at runtime but you should widen `upsertParam`'s signature to `CairnDbExecutor` (matching the existing pattern) so it typechecks cleanly inside the transaction. No raw `conn.sqlite.transaction()` needed.

- DEFAULTS duplication. `DEFAULTS` already exists in `server/src/services/feasibility.ts` (not exported). Don't redefine values independently in `feasibility-params.ts` — export/reuse the existing constant to avoid drift, or have the new service import it.

- Preview reuse. `buildFeasibilityParams` + `computeDayFeasibility` are already exported from `feasibility.ts`. Preview route should validate body via the new strict request schema, then call these directly — no DB read/write. Matches plan.

- `.strict()` schemas. Correct, consistent with the plan's injection-rejection intent. Existing shared schemas don't use `.strict()`, so this is a deliberate new convention for the settings/request types — fine.

- Test placement. Shared tests live as `shared/src/*.test.ts` (e.g. `mirror.test.ts`); service tests as `server/src/services/*.test.ts`. Put new tests at `shared/src/feasibility.test.ts` and `server/src/services/feasibility-params.test.ts`.

- Debounce + AbortController for preview: good, directly addresses the out-of-order-results edge case.

No blockers. Proceed.

## Sonnet Response
- 적용: Atomic write via `db.transaction((tx) => …)`, widen `upsertParam` signature to `CairnDbExecutor`.
- 적용: Reuse existing `DEFAULTS` from `feasibility.ts` (export/import) instead of redefining values in `feasibility-params.ts` — avoids drift.
- 적용: Preview route validates via strict request schema then calls `buildFeasibilityParams` + `computeDayFeasibility` directly, no DB.
- 적용: `.strict()` on settings/request schemas as deliberate new convention.
- 적용: Test placement at `shared/src/feasibility.test.ts` and `server/src/services/feasibility-params.test.ts`.
- 적용: Preview debounce + AbortController for stale cancellation.
- 무시: (none)
