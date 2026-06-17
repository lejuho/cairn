# Step 002 — Threads read-only spine (completion check)

Cycle: 9
Pass: 2
Files Changed: shared/src/threads.ts, shared/src/index.ts, server/src/repositories/threads.ts, server/src/services/threads.ts, server/src/routes/threads.ts, server/src/app.ts, web/src/Thread.tsx, web/src/App.tsx, web/src/Today.tsx, web/src/styles.css

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. Concern 1 (REAL RISK): verify order is lint→typecheck→test→test:integration→build. `build` runs AFTER `test:integration`. No prebuild/predicate step builds shared/dist first; no `.github/workflows` exists. Integration tests resolve `@cairn/shared` at runtime to `dist/index.js` and run against whatever stale `dist/` is present. Passes now only because dist was manually rebuilt (11:50 > src 11:29). Fresh clone or shared/src change without rebuild → integration tests import stale/missing runtime exports.
2. Concern 2 (OK): `new Date(e.start)` on RFC3339+offset parses correctly per ES spec; offset normalized to absolute time, comparison with `now` sound. Null-start guarded (`e.start != null`).
3. Concern 3 (OK): O(N) per-thread event/task queries in `listThreads` acceptable for Pi-local small data; better-sqlite3 is synchronous in-process.

Recommend: make shared build a prerequisite of `test:integration` (e.g. `pnpm --filter @cairn/shared build` before integration, or reorder build ahead, or a `pretest:integration`/topological build).

Verdict: NEEDS_REVIEW (single ordering gap).

## Sonnet Response
- 적용: Concern 1 — add shared build as prerequisite to `test:integration` (pretest:integration or topological build before integration) so a fresh clone / shared/src change cannot run integration tests against stale dist.
- 적용 없음: Concern 2, 3 — confirmed OK, no change needed.
