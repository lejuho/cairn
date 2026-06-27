# Gmail Cancellation Cost A Implementation Plan

Branch: feature/cycle-59-gmail-cancellation-cost-a
Skills: backend-fastify

## Summary

Recent cycles closed the CV chain (`FR-CV-01/02/03`) through saved STAR fields,
deterministic JSON/Markdown export, and client-side copy/file actions. The
remaining high-value gap is now cost input: Decision, Mirror Ledger, and Thread
Settlement already read `events.cancel_money` and `events.refund_cutoff`, but no
implemented path fills those fields from external evidence.

Recommended next spec: **FR-SYNC-05 Gmail cancellation-cost parsing A**.

This cycle implements the smallest backend-only slice: a local one-shot Gmail
cost sync job that scans imminent external GCal events, reads Gmail messages via
the Gmail API, extracts only high-confidence cancellation/refund evidence with a
deterministic parser, and updates empty event cost fields. It does not add UI,
cron, mail sending, Gmail push/webhooks, LLM parsing, schema changes, or new
decision behavior.

## Input/Output Spec

- Input:
  - Local OAuth authorization command:
    - `GMAIL_CLIENT_ID=<id> GMAIL_CLIENT_SECRET=<secret> pnpm gmail:auth`
    - Stores a Gmail readonly token under `.cairn/gmail-token.json`.
    - `CAIRN_GMAIL_TOKEN_PATH` overrides the token path.
  - Local one-shot sync command:
    - `CAIRN_DB_PATH=/path/to/cairn.sqlite3 GMAIL_CLIENT_ID=<id> GMAIL_CLIENT_SECRET=<secret> pnpm gmail:cost-sync`
    - Optional environment:
      - `CAIRN_GMAIL_TOKEN_PATH`
      - `CAIRN_GMAIL_LOOKAHEAD_DAYS` default `14`
      - `CAIRN_GMAIL_NOW` for deterministic local/test runs.
  - Candidate events:
    - `events.source='gcal'`
    - `events.self_imposed=0`
    - `events.status IN ('planned','confirmed')`
    - scheduled in `[now, now + lookaheadDays]`
    - `cancel_money` is `0`/empty and/or `refund_cutoff` is null.
- Output:
  - Normal sync:
    - For each candidate, search Gmail using a bounded query derived from event
      title tokens and event date.
    - Fetch only message metadata/snippet/plain text needed for cost evidence.
    - Parse high-confidence cancellation/refund evidence:
      - `cancelMoney`: non-negative integer KRW amount only when tied to
        cancellation/refund-fee context.
      - `refundCutoff`: `YYYY-MM-DD` only when tied to refund/cancellation
        deadline context.
    - Update only fields for which evidence was found:
      - set `events.cancel_money` when extracted `cancelMoney > 0` and current
        stored value is `0`/empty.
      - set `events.refund_cutoff` when extracted and current stored value is
        null.
      - update `events.updated_at` on writes.
    - Print a deterministic summary:
      - scanned candidate count
      - message count
      - updated event count
      - skipped/no-evidence count
  - Failure:
    - Missing DB path, OAuth credentials, or token path fails before DB writes.
    - Gmail API errors fail the job without partial writes for the current event
      update.
    - Parser ambiguity leaves fields unchanged; unknown remains unknown.
    - Existing nonzero `cancel_money` or existing `refund_cutoff` is never
      overwritten.

## Key Changes

- Backend:
  - Add `server/src/gmail/auth.ts`.
    - Gmail readonly OAuth flow, modeled after GCal auth but using
      `https://www.googleapis.com/auth/gmail.readonly`.
    - Default token path `.cairn/gmail-token.json`.
  - Add `server/src/gmail/client.ts`.
    - `GmailClient` interface with `searchMessages(query, limit)` and
      `getMessage(id)`.
    - `createGmailClient(auth)` adapter around `google.gmail({version:'v1'})`.
    - Tests use fake clients; no real network.
  - Add pure parser/service modules:
    - `server/src/services/gmail-cost-parser.ts`
    - `server/src/services/gmail-cost-sync.ts`
    - Parser is deterministic, regex/token based, and high-precision. No LLM.
  - Extend `server/src/repositories/events.ts` with:
    - `findGmailCostCandidateEvents(db, now, lookaheadDays)`
    - `applyGmailCostEvidence(db, eventId, evidence, updatedAt)`
    - Update helper must preserve existing nonzero money/cutoff and mutate only
      `cancel_money`, `refund_cutoff`, and `updated_at`.
  - Add scripts:
    - `server/scripts/gmail-auth.ts`
    - `server/scripts/gmail-cost-sync.ts`
  - Add package scripts:
    - root: `gmail:auth`, `gmail:cost-sync`
    - server package: `gmail:auth`, `gmail:cost-sync`
  - Update `docs/codebase-map.md` and root command docs with the new local
    one-shot Gmail cost sync boundary.
- Shared:
  - No shared API schema required unless the executor introduces a public
    route. This cycle should stay CLI/job-only.
- Frontend:
  - No frontend changes.

## Sprint Contract

- Passing criteria:
  - Gmail OAuth uses readonly Gmail scope only.
  - Gmail tokens and credentials remain under `.cairn/` or env vars and are not
    committed.
  - Candidate selection is limited to imminent external GCal events.
  - Parser writes only high-confidence cancellation/refund evidence.
  - Ambiguous messages, generic total prices, unrelated receipts, and missing
    title/date evidence do not update events.
  - Existing nonzero `cancel_money` and existing `refund_cutoff` are preserved.
  - DB write helper mutates only `cancel_money`, `refund_cutoff`, and
    `updated_at` on the target event.
  - The job is idempotent: rerunning with the same messages does not change
    already populated fields or duplicate any rows.
  - No schema migration, server route, frontend UI, cron/scheduler, email send,
    Gmail webhook, GCal export/mirror, LLM gateway call, or new decision logic.
  - `docs/codebase-map.md` and command docs reflect the new boundary.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
- Test cases:
  - Pure parser unit tests:
    - Korean cancellation fee text such as `취소 수수료 12,000원` extracts
      `cancelMoney=12000`.
    - Free-cancellation/deadline text such as `6월 30일까지 무료 취소` extracts a
      normalized `refundCutoff` when the year is inferable from the event date.
    - Generic receipt total (`결제금액 12000원`) without cancellation/refund
      context extracts nothing.
    - Multiple amounts pick the amount nearest cancellation/refund context.
    - Malformed dates and overflow dates are rejected.
  - Service unit tests with fake Gmail client:
    - Builds bounded per-event Gmail queries.
    - Skips candidates whose title tokens are too weak/generic.
    - Does not call update when no message has high-confidence evidence.
    - Chooses deterministic evidence when multiple matching messages exist.
    - Handles Gmail client errors without fabricating output.
  - SQLite integration tests:
    - External GCal planned/confirmed event in lookahead is updated.
    - Cairn/self-imposed events are not candidates.
    - Past/far-future/cancelled events are not candidates.
    - Existing nonzero `cancel_money` and existing `refund_cutoff` are preserved.
    - Rerun is idempotent.
    - Row counts for `events`, `annotations`, `threads`, and `tasks` do not
      change except the targeted event fields.
  - Script/config tests:
    - Missing `CAIRN_DB_PATH` exits nonzero before DB access.
    - Missing Gmail OAuth env exits nonzero before DB access.
    - Token path default/override is covered without committing real tokens.
  - Negative scope checks:
    - No LLM call:
      `rg -n "completeChat|LLM_PROXY_BASE_URL|llm/gateway|parse.*Gmail" server/src/gmail server/src/services server/scripts`
    - No frontend or route:
      `git diff --name-only master...HEAD | rg '^web/|server/src/routes/'`
      should have no matches.
    - No email send/webhook/cron:
      `rg -n "send|watch|webhook|history|push|scheduler|cron" server/src/gmail server/src/services/gmail-cost-* server/scripts`
      should not show new delivery or scheduler paths.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Event title is too generic (`영화`, `예약`) and Gmail search would over-match.
  The sync should skip rather than risk writing a wrong cost.
- Email contains a total paid amount and a separate cancellation-fee amount.
  Parser must prefer cancellation/refund-context amounts, not the purchase
  total.
- Event is close to year boundary and message cutoff omits the year. Year
  inference must be deterministic and reject impossible dates.

## Simpler Alternative

Add a manual UI field for `cancel_money`/`refund_cutoff`. That would be much
smaller, but it contradicts the spec direction: cancellation cost should come
from Gmail tickets/reservation mail for external commitments, keeping user input
low. A high-precision one-shot Gmail sync is the smallest slice that actually
advances `FR-SYNC-05` without adding UI or automation risk.

## Assumptions

- `googleapis` is already available through the server package; no new runtime
dependency is needed.
- Gmail readonly scope is sufficient because this cycle only searches and reads
messages.
- Gmail parsing stays deterministic for this A-slice. LLM parsing can be a later
cycle if high-precision regex coverage proves too narrow.
- `cancel_money=0` means "unknown or zero"; this cycle only upgrades it to a
positive amount when evidence exists and never rewrites a populated nonzero
value.
- The job is one-shot/manual like GCal sync. Scheduling/cron is out of scope.

## Review Guidance

### Enumeration Needed

- Gmail boundary:
  - Search:
    `rg -n "gmail|GMAIL|gmail.readonly|CAIRN_GMAIL|GmailClient" server/src server/scripts package.json docs/codebase-map.md AGENTS.md`
  - Expected: only Gmail auth/client/scripts and cost-sync service use Gmail
    terms; scope is readonly.
- Candidate and write scope:
  - Search:
    `rg -n "findGmailCostCandidateEvents|applyGmailCostEvidence|cancelMoney|refundCutoff|cancel_money|refund_cutoff" server/src/repositories/events.ts server/src/services server/src/gmail`
  - Expected: candidate selection is external GCal + imminent; update helper
    mutates only cancel money/cutoff/update timestamp.
- No public surface:
  - Search:
    `git diff --name-only master...HEAD | rg '^web/|server/src/routes/|shared/src'`
  - Expected: no frontend or server route changes; shared changes only if
    executor can justify a non-route type reuse.
- No LLM/sending/automation:
  - Search:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|sendMail|sendMessage|history.watch|webhook|scheduler|cron|TELEGRAM" server/src/gmail server/src/services/gmail-cost-* server/scripts`
  - Expected: no LLM, no outbound email, no Gmail webhook, no scheduler.
- Token safety:
  - Search:
    `git diff --name-only master...HEAD | rg '\\.cairn|token|credentials|secret'`
  - Expected: no real token/credential files; only code/docs mentioning paths.

### Verification Guidance

- Parser behavior: unit tests are required and sufficient.
- Candidate selection and write preservation: SQLite integration tests against a
  temporary database are required because event defaults and constraints matter.
- Gmail API usage: fake client tests are sufficient; do not require real Gmail
  credentials in CI.
- Package/script changes: typecheck/lint/build must prove scripts compile under
  `tsconfig.scripts.json`.
- `corepack pnpm db:generate` should produce no migration; any migration is
  scope creep unless the executor justifies a provenance field and updates this
  plan through the escalation path.
