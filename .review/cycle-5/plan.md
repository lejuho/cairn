# Cycle 5 — Today Review Queue Implementation Plan

Branch: `feature/cycle-5-today-review-queue`
Cycle: `5`
Created: `2026-06-16`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Prepare Cycle 5 without implementation. Create only cycle-control artifacts for
a Today review queue that surfaces recently ended events without annotations
and lets the user submit a one-line reply through the Cycle 4 annotation intake
API.

Preparation pass must create only:
- `.review/cycle-5/status.txt` with `in_progress`
- `.review/cycle-5/plan.md` with this implementation plan
- `.review/cycle-5/advisor-feedback/` directory

Then stop before code changes. Do not edit `server`, `shared`, `web`,
migrations, package files, or `AGENTS.md` in this preparation pass.

## Input/Output Spec

- Existing input:
  - `GET /api/today?date=YYYY-MM-DD&now=<ISO datetime>`
  - `POST /api/events/:id/annotations`
- New `GET /api/today` output fields:
  - `needsReviewEvents: EventRow[]`
  - card union item `{ kind: "needs_review", event: EventRow }`
- Frontend action:
  - Inline reply submits `{ text }` to
    `POST /api/events/:id/annotations`.
  - Successful submit refetches Today.
  - Failed submit keeps the card visible and shows a local error.
- Auth:
  - none, consistent with current local-only cycles.

## Key Changes

- Extend `GET /api/today` shared/server contract:
  - Add `needsReviewEvents: EventRow[]`.
  - Add card union `{ kind: "needs_review", event: EventRow }`.
  - Fixed card priority becomes:
    `conflicts > watchers > next event > two-minute tasks > needs-review`.
- Add deterministic review candidate logic:
  - Candidate event has `end` present and parseable.
  - `event.status` is `planned` or `confirmed`.
  - `event.end <= now`.
  - `event.end >= now - 36 hours`.
  - No row exists in `annotations` for that `event_id`.
  - Sort by most recently ended first.
  - Limit to 3 cards.
- Keep LLM out of Today aggregation:
  - Today may surface review candidates deterministically.
  - Only `POST /api/events/:id/annotations` may invoke the LLM gateway.
- Update `/today` frontend:
  - Render `needs_review` cards in the live stack.
  - Card copy asks a compact one-line question for the event.
  - Provide inline reply input and submit button.
  - Submit calls `POST /api/events/:id/annotations` with `{ text }`, then
    refetches Today.
  - Empty replies are rejected client-side.
  - On submit failure, keep the card visible and show a local error.
- Out of scope:
  - Real Telegram/Web Push delivery.
  - Cron or scheduled prompting.
  - Thread spine.
  - New migrations.
  - Offline write queue.
  - Auth/remote access boundary changes.

## Sprint Contract

- Passing conditions:
  - Ended planned/confirmed events without annotations appear in Today as
    `needs_review`.
  - Events with any annotation are suppressed from needs-review.
  - Review candidates are limited to 3 and sorted by most-recent-ended first.
  - Needs-review cards appear after two-minute tasks in fixed card priority.
  - `/today` can submit a one-line reply to the Cycle 4 annotation intake API
    and refetch.
  - Today aggregation remains deterministic and does not import/call the LLM
    gateway.
  - No migration is added.
- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`
- Backend integration tests with temporary SQLite DB:
  - ended planned event with no annotation appears as `needs_review`
  - ended confirmed event with no annotation appears as `needs_review`
  - event with existing annotation is excluded
  - future event is excluded
  - event older than 36 hours is excluded
  - `done`, `cancelled`, `moved`, and `late` events are excluded
  - candidates are limited to 3 and sorted most-recent-ended first
  - card priority places needs-review after two-minute tasks
  - Today route works with no LLM gateway
- Frontend tests:
  - `/today` renders needs-review card
  - empty inline reply does not call fetch
  - valid reply posts to `/api/events/:id/annotations` and refetches Today
  - failed submit keeps the card visible and shows an error
  - existing loading, quiet, live, and error states remain covered
- Gas limit: N/A.
- Slither: N/A.

## Missing Edge Case Candidates

- Event `end` is malformed or lacks timezone offset.
- Annotation exists but was raw-only because LLM parsing failed.
- A reply submit succeeds but the subsequent Today refetch fails.

## Simpler Alternative

Expose needs-review only in the backend and defer frontend reply UI. This would
reduce frontend complexity, but it would not connect the Cycle 4 annotation
intake path to the Today surface, so Cycle 5 includes the inline reply flow.

## Assumptions

- User selected Today Review Queue for Cycle 5.
- Review window default is last 36 hours.
- Today shows at most 3 needs-review cards.
- Inline reply is the Cycle 5 UI default.
- Existing `annotations` table is sufficient; no migration is expected.
- Any annotation for an event suppresses future review prompts for that event.

## Review Guidance

### Enumeration Needed

- Today review contract:
  - Search: `rg -n "needs_review|needsReviewEvents|annotations" server/src shared/src web/src`
  - Expected: shared schema, server aggregation, frontend card rendering, and
    tests all reference the new contract.
- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src`
  - Expected: Today aggregation has no LLM gateway dependency; only annotation
    intake/parsing uses the gateway.
- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files for Cycle 5.
- Push/cron boundary:
  - Search: `rg -n "telegram|webpush|push|cron|schedule|setInterval" server/src web/src package.json`
  - Expected: no real push channel or cron implementation.

### Verification Guidance

- Review candidate logic requires real temporary SQLite integration tests;
  mocks alone are insufficient.
- Frontend reply behavior should be tested with mocked `fetch` calls.
- Today route must be tested without a gateway argument to prove deterministic
  availability.
- Card priority must be asserted from `data.cards`, not just by checking arrays
  independently.
