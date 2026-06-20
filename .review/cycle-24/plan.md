# Decision Notification Draft A Implementation Plan

Branch: `feature/cycle-24-decision-notification-drafts-a`
Cycle: `24`
Created: `2026-06-20`
Skills: `backend-fastify, frontend-react-pwa`

## Summary

Cycle 24 adds the first person-aware notification draft after a conflict is
successfully resolved. Cycles 18–21 already provide deterministic conflict
resolution and People guards; Cycles 22–23 provide person identity, channel,
and authored lead time. This cycle joins those boundaries:

- resolve a conflict exactly as today;
- identify people attached to the changed event;
- return one deterministic neutral draft per affected person;
- keep the Today conflict sheet open after success so drafts can be copied;
- never send a message automatically.

This is an A-level partial delivery of FR-DEC-07 and FR-PPL-06. Channel and lead
time are personalized from authored profile data. Tone remains explicitly
neutral because Cairn has no authored tone/sensitivity vocabulary yet; no tone
is inferred or fabricated.

Out of scope:

- Telegram, SMS, email, Kakao, or other automatic delivery.
- LLM-generated wording or tone personalization.
- Sensitivities collection/profile changes.
- New-time selection for `outcome="moved"`.
- Pre-resolution draft previews.
- Persisted draft/outbox/history tables.
- Notification reminders, retries, delivery receipts, or background jobs.
- Changes to conflict scoring, People guards, or actionability gates.
- New tables, columns, migrations, or LLM gateway calls.

Preparation pass creates only `.review/cycle-24/*` artifacts and stops before
implementation.

## Input/Output Contract

- Existing request remains unchanged:
  - `POST /api/decisions/conflicts/resolve`
  - Body:
    - `keepEventId`: positive integer;
    - `changeEventId`: positive integer, different from `keepEventId`;
    - `outcome`: `moved | cancelled`;
    - optional non-empty `note`;
    - optional RFC3339 `now` test clock.
  - Existing validation, existence, active-status, overlap, NOW actionability,
    and People guard behavior remain unchanged.

- Extend successful resolve response:
  ```json
  {
    "ok": true,
    "data": {
      "changedEvent": {},
      "annotation": {},
      "notificationDrafts": [
        {
          "personId": 7,
          "personName": "민지",
          "channel": "kakao",
          "leadTimeDays": 3,
          "leadTimeStatus": "late",
          "tone": "neutral",
          "message": "민지님, \"저녁 약속\" 일정 변경이 필요해. 새 시간은 정해지는 대로 알려줄게.",
          "reasonCodes": ["lead_time_late", "tone_profile_unavailable"]
        }
      ]
    }
  }
  ```

- `NotificationDraft` contract:
  - `personId`: positive integer.
  - `personName`: stored person name.
  - `channel`: `none | kakao | sms | email | telegram | null`.
  - `leadTimeDays`: integer `0..30 | null`.
  - `leadTimeStatus`: `enough | late | unknown`.
  - `tone`: literal `neutral`.
  - `message`: deterministic non-empty string.
  - `reasonCodes`: ordered subset of:
    - `channel_unset`;
    - `lead_time_unset`;
    - `lead_time_late`;
    - `event_time_unknown`;
    - `tone_profile_unavailable`.
  - Canonical reason order is channel, lead-time/event-time, then tone.

- Affected-person selection:
  - After all existing resolution checks pass, read only people attached to
    `changeEventId` inside the same resolve transaction.
  - People attached only to `keepEventId` receive no draft.
  - Composite `event_people` identity already prevents duplicate rows; service
    still deduplicates by person id defensively.
  - Stable order: person name ascending, then person id ascending.
  - No affected people returns `notificationDrafts: []`.

- Deterministic message templates:
  - `moved`:
    - `<name>님, "<event title>" 일정 변경이 필요해. 새 시간은 정해지는 대로 알려줄게.`
  - `cancelled`:
    - `<name>님, "<event title>" 일정을 취소해야 해. 미안해.`
  - Stored event title is used as text. No replacement time, reason, relation,
    sensitivity, or emotion is invented.
  - The internal annotation fallback `conflict_resolution` is never exposed as
    notification copy.

- Lead-time classification uses the resolve clock and original changed-event
  start:
  - Valid authored lead time plus parseable event start:
    - `enough` when `eventStart - now >= leadTimeDays * 24h`;
    - otherwise `late` and add `lead_time_late`.
  - Null/malformed lead time: `unknown`, add `lead_time_unset`.
  - Null/malformed event start: `unknown`, add `event_time_unknown`.
  - `leadTimeDays=0` is valid and classifies by the same formula.
  - Comparisons use epoch milliseconds, not RFC3339 lexical order.

- Profile honesty:
  - `channel=null` or `channel="none"` adds `channel_unset`.
  - Tone is always `neutral` and adds `tone_profile_unavailable` because Cycle
    24 has no confirmed tone field.
  - Malformed profile JSON uses existing fail-open parsers and stays unknown.
  - Draft generation is deterministic and LLM-independent.

- Existing failure responses remain unchanged:
  - `400 VALIDATION_ERROR`.
  - `404 NOT_FOUND`.
  - `409 CONFLICT_STALE`.
  - `409 CONFLICT_NOT_ACTIONABLE`.
  - `409 PEOPLE_CONSTRAINT_BLOCKED`.
  - Failed resolution returns no drafts and performs no event/annotation write.

- Today conflict sheet:
  - Existing option/cost/guard UI remains unchanged before resolution.
  - Successful resolution keeps the sheet open and switches to a resolved
    result state.
  - Show changed event/outcome plus `통보 초안` section.
  - Each person card shows name, configured channel or `채널 미설정`, lead-time
    status, `중립 초안` label, selectable message, and `복사` button.
  - `navigator.clipboard.writeText(message)` is the only action. Success shows
    local `복사됨`; failure keeps draft visible and shows a local error.
  - Empty draft list shows `연결된 사람이 없어 통보 초안이 없어.`
  - `완료` closes the sheet and refetches Today so resolved conflicts disappear.
  - No `보내기` action or delivery-success implication is displayed.

## Key Changes

- Shared:
  - Add `NotificationLeadTimeStatusSchema` and `NotificationDraftSchema`.
  - Extend `ResolveConflictResponseDataSchema` with required
    `notificationDrafts`.
  - Export corresponding TypeScript types from the shared barrel.

- Backend:
  - Add a full-profile repository query for people attached to one event,
    ordered by name/id.
  - Add a pure deterministic notification-draft service; do not place template
    construction in route or repository code.
  - Inside the successful conflict transaction, after existing checks and
    writes but before commit, read affected people and build drafts from the
    changed event, selected outcome, and effective resolve clock.
  - Keep existing resolution writes atomic. Any unexpected profile-query or
    draft-construction failure rolls back the event and annotation instead of
    returning an error after mutation. Draft generation itself has no writes.
  - Keep routes free of direct LLM/proxy calls.

- Frontend:
  - Extend existing conflict-sheet state with resolved result/draft state.
  - Preserve conflict sheet after resolve success; render draft cards and copy
    feedback.
  - Refetch Today only when resolved result is dismissed/completed.
  - Keep server error/stale/People-blocked handling local and actionable.
  - Use semantic tokens, 44px targets, focus-visible styles, inert background,
    focus trap/restore, and reduced-motion behavior already established by the
    sheet system.

- Docs:
  - Update `docs/codebase-map.md` with the draft contract/service/repository/UI
    paths.
  - Correct stale Cycle 23 map statements: profile request now has shared
    cross-field refinements, and event-person response paths use normalized full
    `PersonRow` projections.

## Sprint Contract

- Passing criteria:
  - Existing resolve request and every existing failure code remain compatible.
  - Resolution still updates one event and inserts one annotation atomically.
  - Success always includes `notificationDrafts`, including an empty array.
  - Drafts include only people attached to the changed event.
  - One person produces one draft; multiple people sort name then id.
  - Moved copy never claims a replacement time.
  - Cancelled and moved templates are exact and deterministic.
  - Channel/lead-time unknown values remain explicit.
  - Lead-time boundary uses epoch time and treats equality as `enough`.
  - `leadTimeDays=0` is preserved.
  - Tone stays neutral with an explicit unavailable-profile reason.
  - Stale, blocked, invalid, and missing-event paths produce no drafts and no
    partial event/annotation writes.
  - Today keeps successful drafts visible until user completes/dismisses.
  - Copy success/failure is scoped per draft and never claims delivery.
  - Closing resolved state refetches Today; unresolved errors keep conflict
    controls visible.
  - Existing conflict cost/social/guard/NOW behavior does not regress.
  - No LLM dependency, automatic delivery, persistence, or migration is added.
  - `docs/codebase-map.md` is accurate and updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm test:integration`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Shared unit:
    - valid notification draft and extended resolve response;
    - invalid channel/status/tone/reason code/message.
  - Pure backend unit:
    - exact moved/cancelled templates;
    - no replacement-time claim for moved;
    - channel unset/null reasons;
    - lead-time enough/late/equality/zero/unknown and mixed RFC3339 offsets;
    - deterministic dedup/order;
    - malformed profile inputs fail open.
  - Backend integration with temporary SQLite:
    - changed-event people only;
    - no people returns empty array;
    - one/multiple people with stable order and full profile mapping;
    - malformed lead-time JSON remains unknown;
    - existing 400/404/409 paths return no success drafts and preserve event and
      annotation rows;
    - successful resolve still writes exactly one event status and annotation;
    - deterministic endpoints work with no LLM gateway.
  - Frontend:
    - resolve success keeps sheet open and renders exact drafts;
    - moved/cancelled copy and profile metadata;
    - no-person quiet result;
    - per-draft clipboard success and rejection;
    - no send/delivery wording;
    - complete closes and refetches Today;
    - failed resolve retains controls/error;
    - multiple draft ordering and independent copy feedback;
    - focus trap/restore, inert background, 44px targets, and reduced motion;
    - existing conflict/social/guard/actionability tests remain passing.

- Manual checks:
  - Mobile and wide conflict sheet layouts.
  - Light and dark themes.
  - Clipboard success/denial in deployed HTTPS context.
  - Keyboard focus and screen-reader labels.
  - 44px targets and reduced motion.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- One person is attached to both conflicting events. Only attachment to the
  changed event matters; one draft is returned, never two.
- Conflict resolution succeeds but clipboard permission is denied. The stored
  decision remains resolved; draft stays visible for manual selection and copy.
- Event title contains quotes or line breaks. It remains plain React text and
  clipboard text; no HTML interpolation or escaping contract is invented.

## One Simpler Alternative

Show a single generic message after resolution without person/channel/lead-time
metadata. This avoids repository and shared-contract work, but does not advance
FR-DEC-07/FR-PPL-06 and cannot expose missing profile data honestly. Per-person
deterministic drafts reuse existing authored profile fields while keeping
delivery and LLM risk out of scope.

## Assumptions

- Cycle 24 priority is notification draft A after People Profile B.
- Notification draft is generated only after successful resolution, not as a
  speculative pre-resolution preview.
- Affected people are those attached to `changeEventId` only.
- `moved` currently means status change without a replacement start/end.
- Existing event title and person name are trusted local plain text, not HTML.
- Current `PersonRow` fail-open profile parsing remains source of truth.
- Authored `leadTime` is advisory metadata, not a resolution blocker.
- Tone personalization waits for a separately planned sensitivities/tone
  contract; neutral copy is honest A-level behavior.
- Clipboard API is available only in secure browser contexts; rejection has an
  explicit local fallback state.
- No schema migration is expected.

## Review Guidance

### Enumeration Required

- Resolve response consumers:
  - Search: `rg -n "ResolveConflictResponseData|conflicts/resolve|changedEvent|notificationDrafts" shared/src server/src web/src docs/codebase-map.md`
  - Expected: one shared response contract, backend success producer, Today
    consumer/tests, and map entries. Existing error paths unchanged.

- Affected-person projection:
  - Search: `rg -n "find.*People.*Event|eventPeople|PERSON_COLS|mapPersonRow" server/src/repositories server/src/routes server/src/services`
  - Expected: full normalized profiles for changed-event people; no duplicate
    ad hoc row shape or unsafe cast.

- Draft generation boundary:
  - Search: `rg -n "NotificationDraft|leadTimeStatus|tone_profile_unavailable|lead_time_late" shared/src server/src web/src`
  - Expected: schemas in shared, pure deterministic service in server, display
    in Today. Templates must not live in route/repository/frontend.

- Delivery boundary:
  - Search: `rg -n "sendMessage|sendMail|nodemailer|telegram|clipboard|보내기|전송" server/src web/src`
  - Expected: Cycle 24 adds clipboard use only. No outbound channel call or
    delivery-success copy.

- LLM boundary:
  - Search: `rg -n "createLlmGateway|completeChat|LLM_PROXY_BASE_URL|/v1/chat/completions" server/src/routes server/src/services web/src`
  - Expected: notification draft path has no LLM dependency.

- Migration boundary:
  - Search: `find server/drizzle -maxdepth 2 -type f -print | sort`
  - Expected: no new migration files.

### Verification Guide

- Resolve atomicity, event-person selection, profile parsing, stable order, and
  all 400/404/409 no-write paths require real temporary SQLite integration
  tests. Mock-only tests are insufficient.
- Exact template text, lead-time epoch boundaries, reason ordering, dedup, and
  unknown handling may use pure unit tests.
- Frontend may mock `apiJson`/clipboard, but must verify exact resolve response,
  visible post-success state, per-draft feedback, close/refetch timing, and no
  send implication.
- Manual deployed-HTTPS clipboard, mobile/wide, light/dark, keyboard, 44px, and
  reduced-motion checks remain required.
- Reviewer must treat LLM wording, automatic delivery, persistence, tone
  inference, new-time assignment, migrations, and pre-resolution drafts as
  scope creep.
