# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [HIGH] Slot conflict and schedule validation compare RFC3339 strings lexicographically
- Location: `server/src/repositories/events.ts:121`
- Analysis: `findEventsInRange` checks overlap with `e.start! < rangeEnd && e.end! > rangeStart`, and `ScheduleEventRequestSchema` checks `end > start` as strings. RFC3339 values include offsets, so string order is not reliable instant order when offsets differ. Example: an existing event `2026-06-20T00:30:00+00:00` → `2026-06-20T01:30:00+00:00` overlaps candidate `2026-06-20T09:00:00+09:00` → `2026-06-20T10:00:00+09:00`, but string comparison treats the existing end as before the candidate start.
- Impact: Violates the Sprint Contract: candidates must be conflict-free, stale/conflicting PATCH selections must return `409 CONFLICT`, and `end` must be after `start`. Current tests pass because they only use same-offset timestamps.
- Fix Direction: Parse RFC3339 strings to epoch milliseconds for `end > start`, range overlap, and candidate `start <= now` checks. Add integration tests with mixed offsets (`+09:00` candidate against `+00:00` blocker) for candidate generation and schedule PATCH conflict rejection.

### ISSUE-2 [LOW] Slot service imports a helper from the LLM parser module
- Location: `server/src/services/slotCandidates.ts:2`
- Analysis: `slotCandidates.ts` imports `addMinutesToRfc3339` from `server/src/llm/flatEventParser.ts`. The function is pure, but the deterministic slot service now depends on an LLM parser module.
- Impact: Review Guidance expects no Today or slot route/service LLM dependency. This also makes deterministic scheduling code coupled to parser code that can change for LLM reasons.
- Fix Direction: Move the RFC3339 date helper into a neutral deterministic utility module, then import it from both flat capture and slot candidate code.

## Sprint Contract Check
- Today includes unscheduled Cairn planned events in `unscheduledEvents`: PASS
- Today excludes GCal events, already scheduled events, and non-planned statuses from schedule prompts: PASS
- Today card priority places schedule prompts after needs-review: PASS
- Slot candidate API returns up to 3 earliest conflict-free 60-minute slots: FAIL for mixed-offset stored events
- Candidate generation skips candidates that overlap existing non-cancelled events: FAIL for mixed-offset stored events
- Candidate generation skips candidates at or before `now`: PASS for same-offset tests; mixed-offset comparison should be hardened with epoch checks
- Candidate API returns empty candidates when no conflict-free slot exists: PASS
- Schedule PATCH updates `start` and `end` only after validation: PASS
- Schedule PATCH rejects missing, external, already scheduled, invalid, and conflicting events with typed errors: FAIL for mixed-offset conflicts and string-based `end > start`
- `/today` UI renders schedule prompt card and can load candidates: PASS
- Candidate selection calls PATCH, then refetches Today: PASS
- Failed candidate fetch or schedule PATCH keeps card visible and shows local error: PASS
- No LLM gateway import in Today or slot services/routes: PASS for gateway, FAIL for slot service dependency on `server/src/llm/flatEventParser.ts`
- No DB migration is added: PASS
- `docs/codebase-map.md` is updated: PASS

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm test:integration`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check`: PASS

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY

### Applied

RESOLVED: ISSUE-1 — epoch ms comparisons replace string lexicographic order
- `server/src/utils/rfc3339.ts` (new): `rfc3339ToMs(s)` = `Date.parse(s)`, `addMinutesToRfc3339` (moved from flatEventParser).
- `server/src/repositories/events.ts`: `findEventsInRange` filter uses `rfc3339ToMs(e.start!) < rfc3339ToMs(rangeEnd) && rfc3339ToMs(e.end!) > rfc3339ToMs(rangeStart)`.
- `server/src/services/slotCandidates.ts`: past-slot guard uses `rfc3339ToMs(start) <= rfc3339ToMs(nowStr)`.
- `shared/src/slots.ts`: `ScheduleEventRequestSchema` refine uses `Date.parse(v.end) > Date.parse(v.start)`.
- `server/src/routes/slots.integration.test.ts`: 3 new mixed-offset tests — UTC blocker vs +09:00 candidate exclusion, cross-offset end-before-start 400, UTC blocker vs +09:00 PATCH 409.

RESOLVED: ISSUE-2 — deterministic util decoupled from LLM parser module
- `addMinutesToRfc3339` implementation moved to `server/src/utils/rfc3339.ts`.
- `flatEventParser.ts` re-exports it for backward compatibility with `flatCapture.ts`.
- `slotCandidates.ts` imports from `../utils/rfc3339.js` — no LLM module dependency.

자동 체크: verify ✅ (60 web + 132 integration) / git diff --check ✅ / build ✅
