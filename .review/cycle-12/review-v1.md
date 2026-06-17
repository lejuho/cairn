# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Raw fallback responses omit `llmError`
- Location: `server/src/services/flatCapture.ts:20`
- Analysis: `captureFlat` only sets `llmErrorMsg` when `parseFlatEvent` throws. The parser returns `null` for gateway failures, invalid JSON, and invalid schema, so `POST /api/capture/flat-event` can return `captureStatus: "raw_stored"` with `llmError: undefined`.
- Impact: The plan's input/output contract requires parser unavailable, timeout, rate-limit, invalid JSON, or invalid schema responses to include `{ event, captureStatus: "raw_stored", llmError }`. Current integration tests cover raw storage but do not assert the error field.
- Fix Direction: Return a tagged parse result or explicit fallback reason from `parseFlatEvent`, then include `llmError` for all raw fallback paths. Add integration assertions for unavailable/rate-limited/invalid JSON/schema responses.

### ISSUE-2 [LOW] Required `git diff --check` fails on uncommitted spec whitespace
- Location: `docs/cairn-spec.md:443`
- Analysis: The working tree has an uncommitted `docs/cairn-spec.md` edit outside `master...HEAD` with trailing whitespace on the `FR-FEAS-11` table row.
- Impact: The Cycle 12 automatic check contract includes `git diff --check`, and it currently fails even though the whitespace is outside the committed Cycle 12 diff.
- Fix Direction: Remove the trailing whitespace or isolate the unrelated spec edit before rerunning checks. Do not lose the user-authored spec changes.

## Sprint Contract Check
- `POST /api/capture/flat-event` rejects empty text: PASS
- Scheduled parse inserts exactly one Cairn planned event with no thread linkage: PASS
- Missing parsed `end` defaults to `start + 60 minutes`: PASS
- Parse with no start inserts unscheduled event: PASS
- LLM unavailable/rate-limit/invalid JSON/schema raw-stores trimmed input: PASS
- Raw fallback includes `llmError`: FAIL
- Scheduled captures appear in `GET /api/today`: PASS
- Unscheduled captures are persisted but excluded from `dayEvents`: PASS
- Today quick capture posts valid text, refetches Today, and shows saved message for raw/unscheduled outcomes: PASS
- Empty quick capture submit does not call fetch: PASS
- No thread, task, link, or `thread_links` row is created by flat capture: PASS
- No DB migration is added: PASS
- No direct proxy URL or Grok call outside `server/src/llm`: PASS
- `docs/codebase-map.md` updated for new route/service/parser/UI surface: PASS

## Automatic Checks
- `corepack pnpm db:generate`: PASS
- `corepack pnpm test:integration`: PASS
- `corepack pnpm verify`: PASS
- `git diff --check`: FAIL (`docs/cairn-spec.md:443` trailing whitespace)

## Changes Outside Plan
- `docs/cairn-spec.md` has uncommitted spec edits that are not part of `master...HEAD` for Cycle 12. I did not modify or revert them.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY
- ISSUE-2: APPLY

### Applied

RESOLVED: ISSUE-1 — parseFlatEvent returns tagged result; llmError populated on all raw fallback paths
- `server/src/llm/flatEventParser.ts`: return type changed to `ParseFlatEventResult` (`{data, error: null} | {data: null, error: string}`). Failure reasons: `result.error.code` for gateway errors, `"invalid_json"` for JSON parse failure, `"invalid_schema"` for Zod failure.
- `server/src/services/flatCapture.ts`: uses `parseResult.data === null` branch, sets `llmError: parseResult.error` on all raw_stored paths.
- `server/src/routes/capture.integration.test.ts`: 4 raw fallback tests updated to assert `data.llmError` ("unavailable", "rate_limited", "invalid_json", "invalid_schema").

RESOLVED: ISSUE-2 — trailing whitespace removed from docs/cairn-spec.md:443 (FR-FEAS-11 row)

자동 체크: verify ✅ (55 web + 112 integration) / git diff --check ✅ / build ✅
