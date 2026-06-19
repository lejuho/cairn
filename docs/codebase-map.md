# Cairn Codebase Map

Purpose: first-stop navigation doc before broad repo search.

Use this file to narrow read scope. Do not treat it as full spec. Product rules live in [cairn-spec.md](/home/pi/cairn/docs/cairn-spec.md), [cairn-design.md](/home/pi/cairn/docs/cairn-design.md), and [cairn-design-system.md](/home/pi/cairn/docs/cairn-design-system.md).

## Workspace Shape

- `shared/`
  - Runtime schemas and TypeScript contracts shared by server and web.
  - Package runtime entrypoint resolves from `shared/dist`, while schema/type source of truth stays in `shared/src`.
  - Start here when route payload, response shape, enum value, or validation source of truth is question.
- `server/`
  - Fastify API, SQLite access, Drizzle schema/migrations, deterministic Today aggregation, GCal inbound sync, LLM gateway.
  - Optional Telegram long-poll worker handles real needs-review push replies.
  - Start here when behavior touches persistence, sync, route wiring, or integration boundaries.
- `web/`
  - React + Vite PWA shell. Current user-facing surface centers on `/today`.
  - Local dev default: Vite on `5173`, backend proxy target on `3100`.
  - Start here when behavior is UI state, fetch flow, or PWA output.
- `docs/`
  - Product spec and design docs.
- `.review/`
  - Cycle plans, advisor feedback, review verdicts, status files.
- `.claude/`, `.codex/`, `.agents/`
  - Agent workflow rules, hooks, local skills.
- `multi-agent-starter/`
  - Reference/template material. Not main Cairn runtime path.

## First Places To Look

- Root workflow and rules:
  - [AGENTS.md](/home/pi/cairn/AGENTS.md)
  - [.claude/CLAUDE.md](/home/pi/cairn/.claude/CLAUDE.md)
- Workspace scripts and package boundaries:
  - [package.json](/home/pi/cairn/package.json)
  - [pnpm-workspace.yaml](/home/pi/cairn/pnpm-workspace.yaml)
- Server app wiring:
  - [server/src/index.ts](/home/pi/cairn/server/src/index.ts)
  - [server/src/app.ts](/home/pi/cairn/server/src/app.ts)
- DB connection and schema:
  - [server/src/db/index.ts](/home/pi/cairn/server/src/db/index.ts)
  - [server/src/db/schema.ts](/home/pi/cairn/server/src/db/schema.ts)
  - [server/drizzle.config.ts](/home/pi/cairn/server/drizzle.config.ts)
- Shared contract barrel:
  - [shared/src/index.ts](/home/pi/cairn/shared/src/index.ts)
  - Runtime package export: `shared/dist/index.js`
- Web app entry:
  - [web/src/App.tsx](/home/pi/cairn/web/src/App.tsx)
  - [web/src/Today.tsx](/home/pi/cairn/web/src/Today.tsx)

## Server Map

Entry and boot:

- [server/src/index.ts](/home/pi/cairn/server/src/index.ts)
  - CLI/server boot.
  - Default local port: `3100` unless `PORT` overrides it.
  - Opens SQLite DB, runs migrations, builds LLM gateway, starts Fastify.
- [server/src/app.ts](/home/pi/cairn/server/src/app.ts)
  - Route registration boundary.
  - `GET /health` always available.
  - DB-backed routes only register when DB exists.
  - Annotation route only registers when LLM gateway exists.

Data layer:

- [server/src/db/schema.ts](/home/pi/cairn/server/src/db/schema.ts)
  - Drizzle schema source of truth.
  - Current tables:
    - `threads`
    - `events`
    - `annotations`
    - `tasks`
    - `links`
    - `thread_links`
    - `people`
    - `event_people`
    - `watchers`
    - `params`
- [server/src/db/index.ts](/home/pi/cairn/server/src/db/index.ts)
  - `better-sqlite3` connection creation.
  - Enables `PRAGMA foreign_keys = ON`.
  - Runs Drizzle migrations.
- `server/drizzle/`
  - Committed migrations and snapshots.

Route layer:

- [server/src/routes/events.ts](/home/pi/cairn/server/src/routes/events.ts)
  - `POST /api/events` — event creation with optional personIds (transactional).
  - `GET /api/events/:id` — event detail: event + people + annotations (newest-first) + compact thread.
  - `PATCH /api/events/:id/status` — status update (planned/confirmed/done/cancelled/moved/late). Deterministic; no LLM.
- [server/src/routes/tasks.ts](/home/pi/cairn/server/src/routes/tasks.ts)
  - Task creation and status patch APIs.
- [server/src/routes/watchers.ts](/home/pi/cairn/server/src/routes/watchers.ts)
  - Watcher creation and snooze APIs.
- [server/src/routes/today.ts](/home/pi/cairn/server/src/routes/today.ts)
  - `GET /api/today`.
  - Deterministic aggregation only. No LLM dependency.
- [server/src/routes/annotations.ts](/home/pi/cairn/server/src/routes/annotations.ts)
  - `POST /api/events/:id/annotations`.
  - Raw annotation first, best-effort LLM parse second.
- [server/src/routes/threads.ts](/home/pi/cairn/server/src/routes/threads.ts)
  - `POST /api/threads`, `GET /api/threads`, `GET /api/threads/:id`.
  - Deterministic. No LLM dependency. Returns thread detail with linked events/tasks and progress.
- [server/src/routes/capture.ts](/home/pi/cairn/server/src/routes/capture.ts)
  - `POST /api/capture/flat-event`. Registered only when both DB and LLM gateway exist.
  - Parse → fallback → persist order owned by `server/src/services/flatCapture.ts`.
  - Returns `{ event, captureStatus: "scheduled"|"unscheduled"|"raw_stored", llmError? }`.
- [server/src/routes/slots.ts](/home/pi/cairn/server/src/routes/slots.ts)
  - `GET /api/events/:id/slot-candidates?date&now&days` — deterministic 60-min conflict-free candidates. Always registered (no LLM dependency).
- [server/src/routes/feasibility.ts](/home/pi/cairn/server/src/routes/feasibility.ts)
  - `GET /api/feasibility/day?date&now` — deterministic day-level gap check and energy gauge. No LLM dependency.
- [server/src/routes/decisions.ts](/home/pi/cairn/server/src/routes/decisions.ts)
  - `GET /api/decisions/conflicts?date&now` — deterministic conflict decisions with per-event cost breakdown, advisory suggestion, and `actionability: "resolvable"|"read_only"` + `disabledReasonCodes`. Resolvable = either event starts within [now, now+6h]; past-start excluded.
  - `POST /api/decisions/conflicts/resolve` — transaction order: exist→404, active-status→CONFLICT_STALE, overlap→CONFLICT_STALE, actionability→CONFLICT_NOT_ACTIONABLE, then update+annotation. Optional `now` body field for test-clock injection.
  - `PATCH /api/events/:id/schedule` — assigns `start`+`end` to an unscheduled Cairn event. Re-checks conflict; returns 409 on stale selection.
- [server/src/routes/people.ts](/home/pi/cairn/server/src/routes/people.ts)
  - `GET /api/people` — list all people sorted by name.
  - `POST /api/people` — create person (`displayName`, `channel`, optional `relation`). Trims whitespace.
  - `GET /api/events/:id/people` — event + attached people list.
  - `PUT /api/events/:id/people` — replace event's people atomically (dedup, FK-check, transaction delete+insert).

Repository/service split:

- `server/src/repositories/*.ts`
  - Direct DB queries for events, tasks, watchers, annotations, people.
  - [server/src/repositories/people.ts](/home/pi/cairn/server/src/repositories/people.ts) — findAllPeople, createPerson, findEventWithPeople, replaceEventPeople (transaction), findPeopleByIds.
- [server/src/services/today.ts](/home/pi/cairn/server/src/services/today.ts)
  - Builds Today card surface and priority order. Now receives `DayFeasibility` and includes it in `TodaySurface`.
- [server/src/services/decision.ts](/home/pi/cairn/server/src/services/decision.ts)
  - Pure deterministic conflict decision service: detects overlapping planned/confirmed events by epoch ms, computes overlap minutes, urgency (near/planning), actionability (`isResolvable` — strict forward gate: start ≥ now AND start ≤ now+6h), per-event cost extraction, internal score for suggestion ordering (never returned to client). No LLM dependency.
- [server/src/repositories/annotations.ts](/home/pi/cairn/server/src/repositories/annotations.ts)
  - `insertStructuredAnnotation` added: one-shot ledger insert with outcome+reasonTags+reasonText (used by conflict resolve).
- [server/src/services/feasibility.ts](/home/pi/cairn/server/src/services/feasibility.ts)
  - Pure deterministic feasibility computation: energy load (duration-hours sum), adjacent gap classification (ok/tight/impossible), near/planning mode, continuous span check. No LLM dependency. Defaults: energyBudget=8, meetBuffer=15, deepBuffer=30, travelMargin=1, maxContinuous=600.
- [server/src/repositories/params.ts](/home/pi/cairn/server/src/repositories/params.ts)
  - `readParam`, `upsertParam`, `clearParam`. Added `readNumericParam` (Number + isFinite + blank-string guard, falls back to default).
- [server/src/services/annotationIntake.ts](/home/pi/cairn/server/src/services/annotationIntake.ts)
  - Annotation intake transaction flow and fallback behavior.
- [server/src/services/flatCapture.ts](/home/pi/cairn/server/src/services/flatCapture.ts)
  - Flat one-line capture service. Calls `parseFlatEvent`, applies 60-min end default, raw-stores on any parse/gateway failure.
- [server/src/llm/flatEventParser.ts](/home/pi/cairn/server/src/llm/flatEventParser.ts)
  - LLM parser for flat capture. Uses `FlatEventParseResultSchema`. Returns null on gateway error or invalid schema.
- [server/src/services/slotCandidates.ts](/home/pi/cairn/server/src/services/slotCandidates.ts)
  - Deterministic slot candidate service. 5 fixed windows/day (09:00, 11:00, 14:00, 16:00, 19:00), 60-min duration. Filters past slots and overlapping events. Returns up to 3 candidates. No LLM dependency.

External boundaries:

- `server/src/llm/`
  - Only place server should touch Grok proxy contract.
  - [server/src/llm/gateway.ts](/home/pi/cairn/server/src/llm/gateway.ts) owns `/v1/chat/completions` boundary.
  - [server/src/llm/config.ts](/home/pi/cairn/server/src/llm/config.ts) owns `LLM_MODEL` selection, defaulting to `grok-3-mini`.
- `server/src/gcal/`
  - Google Calendar inbound-only sync.
  - Auth, client, event mapping, sync token behavior.
- `server/src/telegram/`
  - Telegram Bot API client and long-poll worker for real needs-review prompts.
  - Uses `params` for offset/dedupe/message mapping state.
  - Operational env: `TELEGRAM_POLL_ENABLED`, `TELEGRAM_BOT_TOKEN`,
    `TELEGRAM_CHAT_ID`, `TELEGRAM_FORCE_IPV4`, `TELEGRAM_POLL_TIMEOUT_SECONDS`,
    and error backoff/log-throttle knobs.
- `server/scripts/`
  - One-shot operational entrypoints such as `gcal:auth` and `gcal:sync`.

## Shared Map

Contracts by domain:

- [shared/src/health.ts](/home/pi/cairn/shared/src/health.ts)
  - `GET /health` response schema.
- [shared/src/events.ts](/home/pi/cairn/shared/src/events.ts)
  - Event row and event request schemas.
- [shared/src/tasks.ts](/home/pi/cairn/shared/src/tasks.ts)
  - Task row and task mutation schemas.
- [shared/src/watchers.ts](/home/pi/cairn/shared/src/watchers.ts)
  - Watcher request/response schemas.
- [shared/src/today.ts](/home/pi/cairn/shared/src/today.ts)
  - Today query and Today surface contract.
- [shared/src/capture.ts](/home/pi/cairn/shared/src/capture.ts)
  - `FlatCaptureRequestSchema`, `FlatEventParseResultSchema`, `CaptureStatusSchema`, `FlatCaptureResponseDataSchema`.
- [shared/src/slots.ts](/home/pi/cairn/shared/src/slots.ts)
  - `SlotCandidateSchema`, `SlotCandidatesQuerySchema`, `ScheduleEventRequestSchema`, `ScheduleEventResponseDataSchema`.
- [shared/src/annotations.ts](/home/pi/cairn/shared/src/annotations.ts)
  - Annotation intake and annotation response contract.
- [shared/src/llm.ts](/home/pi/cairn/shared/src/llm.ts)
  - OpenAI-compatible chat request/response shapes used by gateway boundary.
- [shared/src/enums.ts](/home/pi/cairn/shared/src/enums.ts)
  - Lowercase persisted enum values and related constants.
- [shared/src/people.ts](/home/pi/cairn/shared/src/people.ts)
  - `PersonChannelSchema` (none|kakao|sms|email|telegram), `PersonRowSchema`, `CreatePersonRequestSchema`, `EventPeopleResponseSchema`, `ReplaceEventPeopleRequestSchema`.
- [shared/src/eventDetail.ts](/home/pi/cairn/shared/src/eventDetail.ts)
  - `CompactThreadSchema`, `EventDetailDataSchema` (event+people+annotations+thread), `PatchEventStatusRequestSchema`, `PatchEventStatusResponseDataSchema`.

Rule: when server and web disagree on payload shape, fix shared first.

## Web Map

Entry and routing:

- [web/src/App.tsx](/home/pi/cairn/web/src/App.tsx)
  - Redirects `/` to `/today`.
  - Renders `AppNav` on all primary routes.
  - Handles simple not-found surface (nav still visible).
  - Routes: `/today`, `/input`, `/threads`, `/threads/new`, `/threads/:id`.
- [web/src/AppNav.tsx](/home/pi/cairn/web/src/AppNav.tsx)
  - Shared top navigation bar (cycle 14). Links: Today (`/today`), 입력 (`/input`), 스레드 (`/threads`).
  - `aria-current="page"` on active link. Touch targets ≥44px. Reduced-motion safe.
- [web/src/InputHub.tsx](/home/pi/cairn/web/src/InputHub.tsx)
  - `/input` pull-surface hub (cycle 14). Four states: loading, quiet, live, error.
  - Quiet when `unscheduledEvents.length === 0`; live otherwise.
  - Sections: quick capture (`POST /api/capture/flat-event`), manual add (event/task forms + optional thread picker + people checklist), unscheduled events list.
  - Event form: optional people checklist (cycle 15) from `GET /api/people`; inline person creation (`POST /api/people`). Selected personIds sent in `POST /api/events`. People fetch is best-effort (degraded silently).
  - Unscheduled events: loads slot candidates via `GET /api/events/:id/slot-candidates`, schedules via `PATCH /api/events/:id/schedule`, refetches hub on success.
  - Loads data concurrently: `GET /api/today` + `GET /api/threads` via `Promise.allSettled`. Thread list degrades gracefully on failure.
- [web/src/Today.tsx](/home/pi/cairn/web/src/Today.tsx)
  - Main Today screen.
  - Owns loading, quiet, live, error states.
  - Fetches `/api/today`.
  - Calls task status patch and annotation intake endpoints.
  - Manual intake bottom sheet (cycle 7): task + event creation via `POST /api/tasks` and `POST /api/events`. Sheet opens from quiet-state CTA and live-state "추가" button. `datetime-local` values serialized to RFC3339 with local timezone offset.
  - Daily timeline section (cycle 8): renders `dayEvents` from `GET /api/today` as a compact `오늘 일정` list. Active event marked via `Date.parse()` epoch comparison. Quiet state only when both cards and `dayEvents` are empty.
  - Timeline events: title rendered as a `<button>` that opens the event detail sheet (cycle 16). Events with `threadId` additionally show an `↗` thread link.
  - Schedule prompt (cycle 13): `schedule_prompt` cards rendered in live stack after `needs_review`. "날짜 잡기" button fetches `GET /api/events/:id/slot-candidates`. Up to 3 candidate buttons shown; tap calls `PATCH /api/events/:id/schedule` then refetches Today. Error state keeps card visible with local message.
  - Event detail bottom sheet (cycle 16): `selectedEventId` state; tap on `next_event` card or timeline event opens sheet via `GET /api/events/:id`. Shows title, time, thread name, people list, annotations (newest-first), outcome status buttons (done/cancelled/moved/late), note input. Status PATCH calls `PATCH /api/events/:id/status` then closes sheet + refetches. Note submit calls `POST /api/events/:id/annotations` then refetches detail.
  - Quick capture (cycle 12): compact one-line input shown in quiet and live states. Posts `POST /api/capture/flat-event` with `{text, now}`. Refetches Today on success. Shows "날짜 없이 저장됐어" for `raw_stored`/`unscheduled` outcomes (auto-clears after 4 s). Empty submit is client-side rejected.
  - Thread picker (cycle 10): `GET /api/threads` fetched lazily on bottom sheet open. Optional `<select>` shown when threads exist; `threadId` sent as number in `POST /api/tasks` or `POST /api/events`. Degrades gracefully when thread list fetch fails.
- [web/src/ThreadIndex.tsx](/home/pi/cairn/web/src/ThreadIndex.tsx)
  - `/threads` index page (cycle 10). Loading/empty/live/error states. Lists thread summaries with progress/deadline chips, each linking to `/threads/:id`. "+ 새 스레드" links to `/threads/new`.
- [web/src/ThreadNew.tsx](/home/pi/cairn/web/src/ThreadNew.tsx)
  - `/threads/new` manual creation form (cycle 10). Fields: name (required), kind, goal, deadline. Client-side trim validation. On success navigates to `/threads/:id` via `window.location.href`. Error state preserves form values.
- [web/src/Thread.tsx](/home/pi/cairn/web/src/Thread.tsx)
  - Read-only `/threads/:id` spine (cycle 9). Loading/empty/live/error states. Header: name, goal, deadline, kind, progress chip. Spine split into future/past sections via `new Date()`. Event and task nodes. Null-start events sorted last.
- [web/vite.config.ts](/home/pi/cairn/web/vite.config.ts)
  - Local dev proxy forwards `/api` and `/health` to `http://localhost:3100`.
- [web/src/styles.css](/home/pi/cairn/web/src/styles.css)
  - Semantic tokens and Today surface styling.
- `web/public/`
  - Static PWA assets.
- `web/scripts/assert-pwa-build.mjs`
  - Build check for manifest/service worker output.

## Deploy Artifacts (cycle 11)

Production deployment shape: Cloudflare Access + Tunnel → Caddy (`:18080`) → Fastify (`127.0.0.1:3100`). No Docker.

- `deploy/systemd/cairn-server.service.example`
  - systemd unit example. `ExecStart=/usr/bin/node /home/pi/cairn/server/dist/index.js`, `EnvironmentFile=/home/pi/cairn-data/cairn-server.env`, `Restart=on-failure`.
- `deploy/env/cairn-server.env.example`
  - Environment variables: `HOST=127.0.0.1`, `PORT=3100`, `DB_PATH` (Fastify runtime), `CAIRN_DB_PATH` (Drizzle migration — must match `DB_PATH`). Both point to `/home/pi/cairn-data/cairn.sqlite3`. Keep outside repo. Never commit real values.
- `deploy/caddy/Caddyfile.example`
  - Caddy serves published static files from `/var/www/cairn` on `:18080`; `/api/*` and `/health` proxied to `127.0.0.1:3100`; `try_files {path} /index.html` fallback for SPA routes. Do not serve `/home/pi/cairn/web/dist` directly because `/home/pi` may be `700` and cause Caddy 403.
- `deploy/scripts/redeploy-production.sh`
  - Repeatable production redeploy script. Runs pull, install, verify, build,
    static publish to `/var/www/cairn`, Drizzle migration with
    `CAIRN_DB_PATH`, systemd restart, Caddy reload, and local `/health` smoke
    checks.
- `docs/deployment-cloudflare-access.md`
  - Full deployment guide: architecture diagram, Cloudflare dashboard steps (user-owned), local config steps (repo-managed), build/migrate/restart procedure, smoke checklist, security boundary table.

Runtime boundary: Fastify binds `127.0.0.1:3100` (loopback only). Caddy fronts all external traffic. Cloudflare Access enforces authentication before the tunnel. SQLite DB lives at `/home/pi/cairn-data/cairn.sqlite3` (outside repo).

## Tests Map

- Server integration:
  - [server/src/db/schema.integration.test.ts](/home/pi/cairn/server/src/db/schema.integration.test.ts)
  - [server/src/routes/today.integration.test.ts](/home/pi/cairn/server/src/routes/today.integration.test.ts)
  - [server/src/routes/annotations.integration.test.ts](/home/pi/cairn/server/src/routes/annotations.integration.test.ts)
  - [server/src/gcal/gcal.integration.test.ts](/home/pi/cairn/server/src/gcal/gcal.integration.test.ts)
- Server unit:
  - [server/src/app.test.ts](/home/pi/cairn/server/src/app.test.ts)
  - [server/src/llm/gateway.test.ts](/home/pi/cairn/server/src/llm/gateway.test.ts)
- Shared unit:
  - [shared/src/enums.test.ts](/home/pi/cairn/shared/src/enums.test.ts)
- Web unit/component:
  - [web/src/App.test.tsx](/home/pi/cairn/web/src/App.test.tsx)
  - [web/src/Today.test.tsx](/home/pi/cairn/web/src/Today.test.tsx)

## Review And Cycle Control

- `.review/cycle-N/plan.md`
  - Planned scope and sprint contract.
- `.review/cycle-N/advisor-feedback/`
  - Step-level advisor snapshots.
- `.review/cycle-N/review-vN.md`
  - Codex review verdicts and issue tracking.
- `.review/cycle-N/status.txt`
  - `in_progress`, `ready_to_merge`, or `escalated`.

## Search Shortcuts

Use these before broad manual reads:

- All server routes:
  - `rg -n "app\\.(get|post|patch|put|delete)\\(" server/src/routes`
- All tables:
  - `rg -n "sqliteTable\\(" server/src/db/schema.ts`
- Today contract usage:
  - `rg -n "TodaySurface|needsReviewEvents|needs_review" shared/src server/src web/src`
- LLM boundary:
  - `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src`
- GCal boundary:
  - `rg -n "gcal|syncToken|external_calendar_id|external_event_id" server/src`
- Telegram boundary:
  - `rg -n "telegram|getUpdates|sendMessage|reply_to_message|TELEGRAM_" server/src`
- Cycle artifacts:
  - `find .review/cycle-* -maxdepth 2 -type f | sort`

## Maintenance Rule

Update this file when changes add, remove, or move:

- workspace packages
- server routes, services, repositories, or external boundaries
- shared contract entrypoints
- DB schema or migration ownership paths
- major web entry surfaces
- cycle-control directories or workflow-critical docs
