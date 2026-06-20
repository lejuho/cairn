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
  - `GET /api/people/directory?now=` — sorted people list with totalMeets, lastMet, frequencyBand, preferredWindows, leadTime per person. Sorted: lastMet desc by epoch (nulls last), then name asc, id asc. 400 on missing/invalid now.
  - `GET /api/people/:id/detail?now=` — person (with stats + profile fields) + up to 10 recent qualifying meetings newest-first. 400 on invalid id/now, 404 on missing person.
  - `GET /api/people` — list all people sorted by name. Includes `hardConstraints`, `preferredWindows`, `leadTime` (all fail-open parsed from JSON columns).
  - `POST /api/people` — create person (`displayName`, `channel`, optional `relation`). Trims whitespace.
  - `GET /api/events/:id/people` — event + attached people list.
  - `PUT /api/events/:id/people` — replace event's people atomically (dedup, FK-check, transaction delete+insert).
  - `PUT /api/people/:id/hard-constraints` — replace person's hard constraints from `{ unavailableWeekdays: Weekday[] }`. Deduplicates, serializes to JSON column. Returns `{ ok: true, data: { person } }`. 404 on unknown id.
  - `PUT /api/people/:id/profile` — full atomic replacement of authored availability profile (`preferredWeekdays`, `preferredPeriods`, `leadTimeDays`, `channel`, `unavailableWeekdays`). Normalizes duplicates in canonical enum order. Rejects half-empty windows, preferred/unavailable overlap, invalid channel/lead-time. Returns `{ ok: true, data: { person: PersonRow } }`. No partial writes.

Repository/service split:

- `server/src/repositories/*.ts`
  - Direct DB queries for events, tasks, watchers, annotations, people.
  - [server/src/repositories/people.ts](/home/pi/cairn/server/src/repositories/people.ts) — `PERSON_COLS` constant + `mapPersonRow` helper (unified full-column projection for all single-table reads). `findAllPeople`, `findPersonById`, `createPerson`, `findPeopleDirectoryRows` — all use `PERSON_COLS`+`mapPersonRow` and return normalized `PersonRow` including `preferredWindows`/`leadTime`. `findEventWithPeople`, `replaceEventPeople`, `findPeopleByIds` — join paths now also use `PERSON_COLS`+`mapPersonRow`, returning full `PersonRow[]`. `findEventPeopleContext` — minimal projection for social/guard context only. `findEventPeopleFullProfiles(db, eventId)` — returns full `PersonRow[]` ordered name/id; used by conflict resolve to build notification drafts. `isQualifyingMeet`, `queryMeetingStats`, `findRecentMeetings`, `replaceHardConstraints`, `updatePersonProfile`.
- [server/src/services/people-impact.ts](/home/pi/cairn/server/src/services/people-impact.ts)
  - Pure service (no DB). `parseHardConstraints` (fail-open JSON → HardConstraint[]), `parsePreferredWindows` (fail-open JSON → AuthoredPreferredWindows|null), `parseLeadTime` (fail-open JSON → AuthoredLeadTime|null), `toFrequencyBand` (0→cold_start/+0, 1-2→rare/+2, 3-7→established/+1, 8+→frequent/+0), `computeSocialContext` (base + adjustments from people history), `extractWeekday` (literal-date UTC — `isoStart.slice(0,10)+"T00:00:00Z"`), `evaluatePeopleGuard` (kept event weekday vs people's weekday_unavailable constraints; fail-open on malformed JSON).
- [server/src/services/today.ts](/home/pi/cairn/server/src/services/today.ts)
  - Builds Today card surface and priority order. Now receives `DayFeasibility` and includes it in `TodaySurface`.
- [server/src/services/decision.ts](/home/pi/cairn/server/src/services/decision.ts)
  - Pure deterministic conflict decision service: detects overlapping planned/confirmed events by epoch ms, computes overlap minutes, urgency (near/planning), actionability (`isResolvable` — strict forward gate: start ≥ now AND start ≤ now+6h), per-event cost extraction, internal score for suggestion ordering (never returned to client). Now accepts optional `eventPeopleContext: Map<number, PersonContextItem[]>` for social cost and guard evaluation. Blocked options excluded from suggestions; one-side-block adds `"required_by_people_constraint"` to unblocked side's reasonCodes. Resolve route re-checks guard in-transaction; returns 409 `PEOPLE_CONSTRAINT_BLOCKED` if blocked. No LLM dependency.
- [server/src/services/notification-drafts.ts](/home/pi/cairn/server/src/services/notification-drafts.ts)
  - Pure deterministic notification draft service (no DB, no LLM). `buildNotificationDrafts(affectedPeople, eventTitle, outcome, changedEventStart, nowMs)` — one draft per person with lead-time classification (enough/late/unknown via epoch ms), channel honesty (null/none → channel_unset), tone always neutral (tone_profile_unavailable), ordered reasonCodes. Deduplicates by personId (first-seen order). Called inside the conflict resolve transaction so any unexpected failure rolls back the event/annotation writes.
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
  - `PersonChannelSchema` (none|kakao|sms|email|telegram), `PersonRowSchema` (includes optional `hardConstraints`, `preferredWindows: AuthoredPreferredWindows|null`, `leadTime: AuthoredLeadTime|null`), `CreatePersonRequestSchema`, `EventPeopleResponseSchema`, `ReplaceEventPeopleRequestSchema`.
  - `WeekdaySchema`, `HardConstraintSchema` (discriminated union; `weekday_unavailable` variant has `weekday`, `text`, `firmness: "hard"`), `ReplaceHardConstraintsRequestSchema`.
  - `PreferredPeriodSchema` (morning|afternoon|evening), `AuthoredPreferredWindowsSchema` (weekdays min-1, periods min-1, firmness: "hard"), `AuthoredLeadTimeSchema` (days: int 0..30, firmness: "hard").
  - `UpdatePersonProfileRequestSchema` — full-replacement profile body; shape-validates only (overlap/half-empty check is server business logic).
  - `FrequencyBandSchema` — canonical enum: `cold_start|rare|established|frequent`. Canonical location; `decision.ts` and `people-directory.ts` import from here, not inline.
- [shared/src/people-directory.ts](/home/pi/cairn/shared/src/people-directory.ts)
  - `PersonDirectoryQuerySchema`, `PersonDetailQuerySchema` (both require `now: RFC3339 datetime with offset`).
  - `PersonDirectoryRowSchema` = `PersonRowSchema` extended with `totalMeets`, `lastMet`, `frequencyBand`.
  - `PersonDirectoryResponseSchema`, `PersonDetailResponseSchema`.
- [shared/src/decision.ts](/home/pi/cairn/shared/src/decision.ts)
  - `RelationshipContributionSchema`, `SocialContextSchema` (`base/adjustment/effective/confidence/contributions`), `PeopleGuardConstraintSchema`, `PeopleGuardSchema` (`blocked/keepEventId/reasonCodes/constraints`).
  - `ConflictDecisionOptionSchema` extended with optional `socialContext` and `peopleGuard`.
  - `ResolveConflictResponseDataSchema` — extended with required `notificationDrafts: NotificationDraft[]`. `ResolveConflictResponseData` type exported.
- [shared/src/notification-drafts.ts](/home/pi/cairn/shared/src/notification-drafts.ts)
  - `NotificationLeadTimeStatusSchema` (enough|late|unknown), `NotificationReasonCodeSchema`, `NotificationDraftSchema` — full contract for per-person deterministic notification drafts. `personId`, `personName`, `channel` (null when none/unset), `leadTimeDays`, `leadTimeStatus`, `tone` (literal "neutral"), `message` (non-empty), `reasonCodes`. Imported by `decision.ts` to compose the resolve response.
- [shared/src/eventDetail.ts](/home/pi/cairn/shared/src/eventDetail.ts)
  - `CompactThreadSchema`, `EventDetailDataSchema` (event+people+annotations+thread), `PatchEventStatusRequestSchema`, `PatchEventStatusResponseDataSchema`.

Rule: when server and web disagree on payload shape, fix shared first.

## Web Map

Entry and routing:

- [web/src/App.tsx](/home/pi/cairn/web/src/App.tsx)
  - Redirects `/` to `/today`.
  - Renders `AppNav` on all primary routes.
  - Handles simple not-found surface (nav still visible).
  - Routes: `/today`, `/input`, `/threads`, `/threads/new`, `/threads/:id`, `/people`, `/people/:id`.
- [web/src/AppNav.tsx](/home/pi/cairn/web/src/AppNav.tsx)
  - Shared top navigation bar. Links: Today (`/today`), 입력 (`/input`), 스레드 (`/threads`), 사람 (`/people`).
  - `aria-current="page"` on active link (including `/people/:id` matching 사람 link). Touch targets ≥44px. Reduced-motion safe.
- [web/src/api.ts](/home/pi/cairn/web/src/api.ts)
  - Frontend fetch boundary (cycle 20). Wraps `fetch` + JSON parsing; classifies errors as `AccessSessionError` (`kind: "access_session_required"`) or `ApiError`.
  - Detection order: (1) 302/401/403 status → access_session_required; (2) `response.redirected` + cloudflareaccess.com URL → access_session_required; (3) HTML/text body with CF Access markers (`/cdn-cgi/access/login`, `cloudflareaccess.com`) → access_session_required; (4) HTML without markers → api_error; (5) fetch() rejection (network error) → access_session_required with "로그인 세션이 만료됐거나 네트워크가 끊겼어".
  - Used by Today.tsx and InputHub.tsx for all API calls: top-level loads, secondary reads, and mutations. Thread/ThreadIndex/ThreadNew screens use direct fetch (not yet migrated).
- [web/src/InputHub.tsx](/home/pi/cairn/web/src/InputHub.tsx)
  - `/input` pull-surface hub (cycle 14). Five states: loading, quiet, live, error, access_error.
  - Quiet when `unscheduledEvents.length === 0`; live otherwise.
  - Sections: quick capture (`POST /api/capture/flat-event`), manual add (event/task forms + optional thread picker + people checklist), unscheduled events list.
  - Event form: optional people checklist (cycle 15) from `GET /api/people`; inline person creation (`POST /api/people`). Selected personIds sent in `POST /api/events`. People fetch is best-effort (degraded silently).
  - People checklist (cycle 21): each person row has a "제약" button (`aria-label="{name} 요일 제약 설정"`) that opens a weekday constraint bottom sheet. Sheet reads existing `hardConstraints` from the loaded person list, toggles weekdays (aria-pressed), saves via `PUT /api/people/:id/hard-constraints`, then re-fetches people and closes. Save failure keeps sheet open with error; personIds selection preserved across open/save.
  - Unscheduled events: loads slot candidates via `GET /api/events/:id/slot-candidates`, schedules via `PATCH /api/events/:id/schedule`, refetches hub on success.
  - Loads data concurrently: `GET /api/today` + `GET /api/threads` via `apiJson`. Thread list degrades gracefully on failure. Access session errors show "Access 로그인 다시 열기" button (`window.location.assign`).
- [web/src/Today.tsx](/home/pi/cairn/web/src/Today.tsx)
  - Main Today screen.
  - Five states: loading, quiet, live, error, access_error. Top-level load via `apiJson`; Access session failures show "로그인 세션이 필요해" title and "Access 로그인 다시 열기" button (`window.location.assign`).
  - Fetches `/api/today`.
  - Calls task status patch and annotation intake endpoints.
  - Manual intake bottom sheet (cycle 7): task + event creation via `POST /api/tasks` and `POST /api/events`. Sheet opens from quiet-state CTA and live-state "추가" button. `datetime-local` values serialized to RFC3339 with local timezone offset.
  - Daily timeline section (cycle 8): renders `dayEvents` from `GET /api/today` as a compact `오늘 일정` list. Active event marked via `Date.parse()` epoch comparison. Quiet state only when both cards and `dayEvents` are empty.
  - Conflict sheet (cycle 21): renders per-option `socialContext.contributions` (person name, meet count, frequency band, adjustment). Blocked options (`peopleGuard.blocked === true`) show "제약" badge (`.conflict-blocked-badge`), constraint reasons list, and disabled action buttons. One-side-blocked unblocked option remains actionable. Both-blocked shows "두 선택지 모두 사람 제약에 걸려있어. 직접 일정을 조율해줘." copy; both options' action buttons are rendered but disabled (not omitted).
  - Timeline events: title rendered as a `<button>` that opens the event detail sheet (cycle 16). Events with `threadId` additionally show an `↗` thread link.
  - Schedule prompt (cycle 13): `schedule_prompt` cards rendered in live stack after `needs_review`. "날짜 잡기" button fetches `GET /api/events/:id/slot-candidates`. Up to 3 candidate buttons shown; tap calls `PATCH /api/events/:id/schedule` then refetches Today. Error state keeps card visible with local message.
  - Event detail bottom sheet (cycle 16): `selectedEventId` state; tap on `next_event` card or timeline event opens sheet via `GET /api/events/:id`. Shows title, time, thread name, people list, annotations (newest-first), outcome status buttons (done/cancelled/moved/late), note input. Status PATCH calls `PATCH /api/events/:id/status` then closes sheet + refetches. Note submit calls `POST /api/events/:id/annotations` then refetches detail.
  - Quick capture (cycle 12): compact one-line input shown in quiet and live states. Posts `POST /api/capture/flat-event` with `{text, now}`. Refetches Today on success. Shows "날짜 없이 저장됐어" for `raw_stored`/`unscheduled` outcomes (auto-clears after 4 s). Empty submit is client-side rejected.
  - Thread picker (cycle 10): `GET /api/threads` fetched lazily on bottom sheet open. Optional `<select>` shown when threads exist; `threadId` sent as number in `POST /api/tasks` or `POST /api/events`. Degrades gracefully when thread list fetch fails.
- [web/src/PeopleDirectory.tsx](/home/pi/cairn/web/src/PeopleDirectory.tsx)
  - `/people` screen. States: loading, quiet (no people), live (person cards), error, access_error.
  - Quiet: "아직 사람이 없어" + link to /input. Live: card list showing name, relation, frequencyLabel, totalMeets, lastMet. Each card links to `/people/:id`.
  - Fetches `GET /api/people/directory?now=` via `apiJson`.
- [web/src/lastMet.ts](/home/pi/cairn/web/src/lastMet.ts)
  - `formatLastMet(lastMet)` shared by both People screens. Localized date+time (`toLocaleString` year/month/day/hour/minute); null/malformed → explicit `만남 기록 없음` fallback (never inferred).
- [web/src/PersonDetail.tsx](/home/pi/cairn/web/src/PersonDetail.tsx)
  - `/people/:id` screen. States: loading, live, not_found, error, access_error.
  - Live: person header (name, relation, channel if not "none"), stats (totalMeets, lastMet, frequencyBand), 취급 프로필 section (preferredWindows, leadTime, channel, hardConstraints — all display "설정 없음" when null), recentMeetings list.
  - 프로필 편집 button opens a bottom sheet with: 7 preferred-weekday toggles, morning/afternoon/evening period toggles, lead-time notice chips (당일/1일/3일/7일/14일/30일/설정없음), channel chips, 7 unavailable-weekday toggles. Selecting preferred day clears same day from unavailable and vice versa (mutual exclusion). Save calls `PUT /api/people/:id/profile`; success closes sheet and refetches. Save failure retains selections with local error alert. Backdrop tap, Escape, 닫기 close without mutation.
  - Not-found: "사람을 찾을 수 없어" + link to /people.
  - Fetches `GET /api/people/:id/detail?now=` via `apiJson`.
- [web/src/ThreadIndex.tsx](/home/pi/cairn/web/src/ThreadIndex.tsx)
  - `/threads` index page (cycle 10). Loading/empty/live/error states. Lists thread summaries with progress/deadline chips, each linking to `/threads/:id`. "+ 새 스레드" links to `/threads/new`.
- [web/src/ThreadNew.tsx](/home/pi/cairn/web/src/ThreadNew.tsx)
  - `/threads/new` manual creation form (cycle 10). Fields: name (required), kind, goal, deadline. Client-side trim validation. On success navigates to `/threads/:id` via `window.location.href`. Error state preserves form values.
- [web/src/Thread.tsx](/home/pi/cairn/web/src/Thread.tsx)
  - Read-only `/threads/:id` spine (cycle 9). Loading/empty/live/error states. Header: name, goal, deadline, kind, progress chip. Spine split into future/past sections via `new Date()`. Event and task nodes. Null-start events sorted last.
- [web/vite.config.ts](/home/pi/cairn/web/vite.config.ts)
  - Local dev proxy forwards `/api` and `/health` to `http://localhost:3100`.
- [web/src/styles.css](/home/pi/cairn/web/src/styles.css)
  - Semantic tokens and surface styling. People directory/detail selectors (`.person-card`, `.person-detail-*`, `.person-stats`, `.meeting-list/item`, `.back-link`, `.action-btn`, `.section-heading`, `.loading-indicator`) use tokens only, 44px targets, `:focus-visible`, single-column mobile + `min-width: 720px` enhancement, and reduced-motion safety.
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
  - [web/src/PeopleDirectory.test.tsx](/home/pi/cairn/web/src/PeopleDirectory.test.tsx)
  - [web/src/PersonDetail.test.tsx](/home/pi/cairn/web/src/PersonDetail.test.tsx)

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
