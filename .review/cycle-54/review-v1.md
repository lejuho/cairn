# Codex Review v1

## Verdict
BLOCKED

## Findings
### ISSUE-1 [MEDIUM] Current kind is trimmed before exact-kind evidence lookup
- 위치: server/src/services/threads.ts:96
- 분석: `getThreadDetail` computes `const kind = thread.kind?.trim()` and passes that trimmed value to `findCompletedThreadsByKind`. The plan's Sprint Contract requires evidence threads where `threads.kind` exactly equals the current thread kind. `CreateThreadRequestSchema` trims only `name`, not `kind`, so persisted `kind` can contain leading/trailing whitespace. With the current implementation, a current thread kind of `" trip "` queries evidence kind `"trip"` instead of the exact stored current kind.
- 영향: The same-kind evidence boundary can include non-exact matches and miss exact persisted matches. This violates the FR-THR-08 A-slice rule "Only other completed same-kind threads contribute evidence" and the Assumption "Exact `threads.kind` equality is sufficient".
- 수정 방향: Use trim only for the non-empty eligibility check, but pass the raw persisted `thread.kind` to `findCompletedThreadsByKind`. Add an integration test with a padded current kind to prove `" trip "` does not match `"trip"` and, if desired, does match another exact `" trip "` completed thread.

## Sprint Contract Check
- `GET /api/threads/:id` includes required `missingNodeSuggestions`: PASS.
- Threads with empty kind, `done`, or `dropped` status return no suggestions: PASS for null/blank/done/dropped; exact-kind caveat above.
- Only other completed same-kind threads contribute evidence: BLOCKED by ISSUE-1.
- Only direct historical `done` events/tasks contribute evidence: PASS.
- Current direct node titles suppress matching suggestions: PASS.
- Contains descendants, different-kind threads, active/paused/dropped historical threads, cancelled/moved/planned events, and todo/dropped tasks do not contribute: PASS for implemented direct-read and status rules; exact-kind caveat above.
- Suggestions are deterministic, limited to 5, and sorted by evidence count then stable title/kind order: PASS.
- Suggestions carry `firmness="soft"` and `source="inferred"`: PASS.
- No historical order, start/end/due date, dependency edge, score, recommendation, or money estimate is copied: PASS.
- Existing thread detail fields remain stable: PASS.
- UI presents suggestions as descriptive evidence only; no apply/create/confirm/CV/status mutation: PASS.
- Today, slot, feasibility, decision, watcher, mirror, resources, GCal, Telegram, and LLM behavior are not changed: PASS.
- `docs/codebase-map.md` reflects the new boundary: PASS.

## Automatic Checks
- `corepack pnpm db:generate`: PASS, no schema changes.
- `git diff --check master..HEAD`: PASS.
- Static deterministic-boundary scan: PASS. Matches are the new shared schemas/types, pure service, repository reads, thread detail wiring, UI/tests, and docs.
- Service isolation scan for LLM/time/random/DB/mutation in `server/src/services/thread-missing-node-suggestions.ts`: PASS, no matches.
- Static no mutation / no speculative copy scan: PASS with expected false positives only (`orderBy`, test insert helpers, reject-field tests, and no-button/no-PATCH/no-POST tests).
- Static scope scan: PASS, no matches.
- `corepack pnpm verify`: PASS.
  - Unit: shared 364 + server 417 + web 380 tests.
  - Integration: 609 tests.
  - Build: PASS.

## Changes Outside Plan
No code scope creep found. The working tree still has pre-existing uncommitted workflow files outside cycle 54; I left them untouched.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-1: APPLY

### Applied

RESOLVED: ISSUE-1 — same-kind evidence now matches the EXACT persisted kind
- `server/src/services/threads.ts` (getThreadDetail): the trim is now used ONLY for the non-empty eligibility check (`const kindTrimmed = thread.kind?.trim()`); the evidence lookup passes the RAW persisted `thread.kind` to `findCompletedThreadsByKind`, so `eq(threads.kind, rawKind)` stays exact. Guard tightened to `if (kindTrimmed && thread.kind != null && status not done/dropped)` (null-safe; blank/done/dropped early-skip unchanged). A current kind of `" trip "` no longer queries `"trip"`.
- `server/src/routes/thread-missing-node-suggestions.integration.test.ts`: added a test where a padded current kind `" trip "` matches an evidence thread with exact `" trip "` (done) and does NOT match one with `"trip"` (done) — asserting the suggestion comes only from the exact-kind thread.

자동 체크: `corepack pnpm verify` EXIT=0 (610 tests, +1 new integration) ✅ / `corepack pnpm db:generate` no schema changes ✅ / `git diff --check master..HEAD` clean ✅ / deterministic-boundary + service-isolation + no-mutation + scope scans clean ✅

### Note on Changes Outside Plan
The pre-existing uncommitted workflow/infra files (`.claude/*`, `AGENTS.md`, `CONTRACT_MARKERS.md`) noted in the review are user-owned Hermes tooling outside cycle-54 plan scope; this pass leaves them untouched (not committed, not discarded), consistent with prior cycles.
