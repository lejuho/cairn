# Cycle 6 — Telegram Needs-Review Push

Branch: `feature/cycle-6-telegram-review-push`
Cycle: `6`
Created: `2026-06-17`
Skills: `backend-fastify`

## Summary

Cycle 6 closes first real push loop. Existing local review flow already exists:
- deterministic needs-review selection in Today
- annotation intake API
- LLM parse fallback

This cycle adds real outbound/inbound Telegram delivery for **needs-review only**. Channel is **Telegram first**, transport is **long polling**, and server remains single-process: Fastify boot optionally starts Telegram worker when env is enabled.

Out of scope:
- Web Push
- watcher push
- thread generation/spine
- Gmail parsing
- auth/remote exposure boundary
- webhook mode
- cron/scheduler outside server process
- new frontend UI

## Key Changes

- Telegram worker:
  - Add env-gated background worker inside server boot, not separate deployment unit.
  - New env contract:
    - `TELEGRAM_POLL_ENABLED=1`
    - `TELEGRAM_BOT_TOKEN`
    - `TELEGRAM_CHAT_ID`
  - If env is missing or Telegram fails, `/health`, `/api/today`, GCal sync, and annotation intake must still work.

- Outbound prompt behavior:
  - Reuse existing **needs-review** candidate logic from Today.
  - Send prompts only for events that:
    - currently qualify for needs-review
    - have no annotation
    - have not already been Telegram-prompted
  - Prompt text is deterministic, no LLM:
    - event title
    - event time window
    - one-line question asking what happened
  - Send at most **one new prompt per poll sweep** to preserve silence.
  - No resend/reminder in Cycle 6 once a prompt was successfully sent.

- Inbound reply behavior:
  - Accept messages only from configured `TELEGRAM_CHAT_ID`.
  - Reply must be a Telegram **reply-to** the bot’s prompt message.
  - Map `reply_to_message.message_id` to `event_id`, then call existing annotation intake service directly.
  - Success path:
    - annotation stored through existing raw-first / parse-second flow
    - send short Telegram ack
  - Fallback path:
    - if parse result is `raw_stored`, send ack that raw text was saved and structured parse is unavailable
  - Unknown messages, wrong chat, and non-reply text are ignored in Cycle 6.

- State storage:
  - No migration.
  - Use `params` table for Telegram worker state:
    - `telegram.offset`
    - `telegram.reviewPrompted.<eventId>`
    - `telegram.promptMessage.<messageId>`
  - Remove `telegram.promptMessage.<messageId>` after a successful matched reply.
  - Keep `telegram.reviewPrompted.<eventId>` as durable dedupe marker; annotated events are already suppressed by existing logic.

- Boundaries and reuse:
  - Keep Today aggregation deterministic. No LLM added there.
  - Reuse existing annotation intake service, not internal HTTP calls.
  - Extract shared needs-review selector only if required so Today route and Telegram worker use identical candidate rules.

## Test Plan

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- Required integration tests with temp SQLite and mocked Telegram API:
  - Telegram worker sends one prompt for an eligible needs-review event.
  - Annotated event is never prompted.
  - Already-prompted event is not sent again.
  - Worker stores `telegram.offset`, prompt marker, and prompt message mapping in `params`.
  - Reply-to known prompt creates annotation through existing service flow.
  - Parsed reply sends success ack.
  - `raw_stored` fallback sends raw-saved ack and keeps event deterministic surfaces healthy.
  - Message from wrong chat is ignored.
  - Non-reply inbound text is ignored.
  - Worker/API startup with Telegram env absent still serves `/health` and `/api/today`.
  - No Telegram code imports LLM gateway except through existing annotation parse boundary.
  - No migration files are added.

- Boundary enumeration:
  - `rg -n "telegram|getUpdates|sendMessage|reply_to_message|TELEGRAM_" server/src`
  - `rg -n "needs_review|needsReviewEvents" server/src shared/src`
  - `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected:
    - Telegram logic only in new worker/modules
    - Today deterministic logic reused, not duplicated inconsistently
    - no new migration

## Assumptions

- Telegram is first real push channel because single-user Pi deployment is simpler than Web Push.
- Long polling is chosen to avoid public webhook exposure before auth/remote boundary is designed.
- Cycle 6 handles **needs-review only**; watcher push waits for later cycle.
- Single configured chat is source of truth for Telegram replies in Cycle 6.
- One successful prompt per event is enough for v1; reminder policy is deferred.
