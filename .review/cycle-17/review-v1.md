# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Mixed-offset events are sorted by string before gap math
- 위치: `server/src/services/feasibility.ts:38`
- 분석: `computeDayFeasibility` filters by literal `YYYY-MM-DD` prefix, then sorts scheduled events with `a.start!.localeCompare(b.start!)`. That is only correct when all offsets are identical. With mixed offsets on the same literal date, string order can disagree with chronological order, and `computeGaps` can classify a false negative/positive gap.
- 영향: The plan explicitly calls out mixed offsets: day membership should keep literal prefix behavior, but gap math should compare epoch milliseconds. Current tests do not cover this edge.
- 수정 방향: Keep `e.start.startsWith(date)` for day membership, but sort scheduled events by `Date.parse(start)` before gap/continuous work. Add an integration test with same-date events using different offsets where string order and epoch order disagree.

## Sprint Contract Check
- `GET /api/feasibility/day` validates `date` and `now`: PASS.
- Scheduled planned/confirmed events on the requested date are included: PASS.
- Cancelled/done/moved/late events are excluded from load and gaps: PASS.
- Energy load is deterministic duration-hours sum: PASS.
- Missing params fall back to explicit Cycle 17 defaults: PASS.
- Invalid numeric params do not crash the route; defaults are used: PASS.
- Adjacent gaps classify as `ok`, `tight`, or `impossible`: PARTIAL. Works for same-offset ordering; mixed-offset ordering is wrong.
- Overlapping events create an `impossible` gap with negative available minutes: PASS.
- `near` mode applies when the gap or next event is within 6 hours of `now`: PASS for covered cases.
- Continuous span warning fires when first-start to last-end exceeds `maxContinuousMinutes`: PASS.
- `GET /api/today` includes `feasibility`: PASS.
- Today UI renders energy gauge in quiet and live states: PASS.
- Today UI renders gap/continuous warnings without changing card priority: PASS.
- No LLM gateway imports in feasibility service/route/Today aggregation: PASS.
- No migration is added: PASS.
- `docs/codebase-map.md` is updated: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS.
- `corepack pnpm test:integration`: PASS.
- `corepack pnpm verify`: PASS.
- `git diff --check`: PASS.

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY

### Applied

RESOLVED: ISSUE-1 — sort scheduled events by epoch ms before gap/continuous math

- `server/src/services/feasibility.ts:38`: `localeCompare` → `Date.parse(a.start!) - Date.parse(b.start!)`
- `server/src/routes/feasibility.integration.test.ts`: added mixed-offset test (B at 09:30+09 = 00:30Z, A at 11:00+00; verifies one ok gap ~570 min, not a false impossible gap)

자동 체크: test:integration ✅ (192 tests) / verify ✅
