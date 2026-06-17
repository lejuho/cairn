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
  - Local event creation APIs.
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

Repository/service split:

- `server/src/repositories/*.ts`
  - Direct DB queries for events, tasks, watchers, annotations.
- [server/src/services/today.ts](/home/pi/cairn/server/src/services/today.ts)
  - Builds Today card surface and priority order.
- [server/src/services/annotationIntake.ts](/home/pi/cairn/server/src/services/annotationIntake.ts)
  - Annotation intake transaction flow and fallback behavior.

External boundaries:

- `server/src/llm/`
  - Only place server should touch Grok proxy contract.
  - [server/src/llm/gateway.ts](/home/pi/cairn/server/src/llm/gateway.ts) owns `/v1/chat/completions` boundary.
- `server/src/gcal/`
  - Google Calendar inbound-only sync.
  - Auth, client, event mapping, sync token behavior.
- `server/src/telegram/`
  - Telegram Bot API client and long-poll worker for real needs-review prompts.
  - Uses `params` for offset/dedupe/message mapping state.
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
- [shared/src/annotations.ts](/home/pi/cairn/shared/src/annotations.ts)
  - Annotation intake and annotation response contract.
- [shared/src/llm.ts](/home/pi/cairn/shared/src/llm.ts)
  - OpenAI-compatible chat request/response shapes used by gateway boundary.
- [shared/src/enums.ts](/home/pi/cairn/shared/src/enums.ts)
  - Lowercase persisted enum values and related constants.

Rule: when server and web disagree on payload shape, fix shared first.

## Web Map

Entry and routing:

- [web/src/App.tsx](/home/pi/cairn/web/src/App.tsx)
  - Redirects `/` to `/today`.
  - Handles simple not-found surface.
- [web/src/Today.tsx](/home/pi/cairn/web/src/Today.tsx)
  - Main Today screen.
  - Owns loading, quiet, live, error states.
  - Fetches `/api/today`.
  - Calls task status patch and annotation intake endpoints.
  - Manual intake bottom sheet (cycle 7): task + event creation via `POST /api/tasks` and `POST /api/events`. Sheet opens from quiet-state CTA and live-state "추가" button. `datetime-local` values serialized to RFC3339 with local timezone offset.
  - Daily timeline section (cycle 8): renders `dayEvents` from `GET /api/today` as a compact `오늘 일정` list. Active event marked via `Date.parse()` epoch comparison. Quiet state only when both cards and `dayEvents` are empty.
  - Timeline events with `threadId` render as `<a href="/threads/:id">` links (cycle 9).
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

Production deployment shape: Cloudflare Access + Tunnel → Caddy (`:8080`) → Fastify (`127.0.0.1:3100`). No Docker.

- `deploy/systemd/cairn-server.service.example`
  - systemd unit example. `ExecStart=/usr/bin/node /home/pi/cairn/server/dist/index.js`, `EnvironmentFile=/home/pi/cairn-data/cairn-server.env`, `Restart=on-failure`.
- `deploy/env/cairn-server.env.example`
  - Environment variables: `HOST=127.0.0.1`, `PORT=3100`, `DB_PATH=/home/pi/cairn-data/cairn.sqlite3`. Keep outside repo. Never commit real values.
- `deploy/caddy/Caddyfile.example`
  - Caddy serves `web/dist` on `:8080`; `/api/*` and `/health` proxied to `127.0.0.1:3100`; `try_files {path} /index.html` fallback for SPA routes.
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
