# Manual Exogenous Watchers + Automation-Need Signal A Implementation Plan

Branch: feature/cycle-36-manual-exogenous-watchers-a
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 36 implements the first useful FR-WAT-10 slice and the foundation for
FR-MIR-05.

Current state:

- Watcher A date-threshold, daily push, `/watch` deep view, and reverse planning
  are implemented.
- Watcher kind `B` exists in the DB enum, but no user-facing B registration or
  logging path exists.
- `/mirror` already has deterministic ledger, pattern, and energy trend sections.
- `docs/codebase-map.md` has one stale cycle-35 line: reverse-plan POST response
  still says `taskIds/targetTaskId/linkIds`; actual implementation returns task
  and link rows.

This cycle adds manual exogenous watcher logging before any crawler exists:

- create a manual B watcher from `/watch`;
- record manual observations/checks for that watcher;
- derive a Mirror "automation need" signal from frequency x missed-signal rate x
  source stability;
- keep the signal descriptive and non-mutating;
- update `docs/codebase-map.md`, including the stale reverse-plan response shape.

Out of scope:

- web crawling, search API calls, n8n, external watcher-B collection, or source
  polling;
- LLM parsing/generation;
- Telegram/PWA push for B watchers;
- automatic arming, automatic watcher creation, or auto-mutation from Mirror;
- Gmail/GCal/map/weather integrations;
- reverse-plan editing/deleting or slot assignment.

## Input/Output Spec

- Input:
  - `POST /api/watchers/manual-exogenous`
    - Body:

```json
{
  "label": "청와대 개방 종료",
  "category": "public",
  "sourceLabel": "공지 페이지",
  "sourceUrl": "https://example.org/notices",
  "sourceStability": "stable"
}
```

    - Validation:
      - `label`: non-empty string;
      - `category`: optional string;
      - `sourceLabel`: optional non-empty string;
      - `sourceUrl`: optional URL string;
      - `sourceStability`: `unknown | stable | volatile`, default `unknown`;
      - strict schema rejects injected `score`, `recommendation`, `advice`,
        auto-action, certainty, or fabricated fields.

  - `POST /api/watchers/:id/manual-log`
    - Body:

```json
{
  "outcome": "missed_signal",
  "observedAt": "2026-06-23T09:00:00+09:00",
  "note": "이미 종료 공지가 올라온 뒤 발견"
}
```

    - Validation:
      - `id`: positive integer;
      - watcher must exist and have rule `type='manual_exogenous'`;
      - `outcome`: `checked_no_signal | signal_seen | missed_signal`;
      - `observedAt`: RFC3339 with offset;
      - `note`: optional non-empty string, max length 500;
      - strict schema rejects injected fields.

  - `GET /api/mirror/automation-needs?from&to`
    - Query:
      - optional `from`, `to`: strict calendar `YYYY-MM-DD`;
      - `from <= to`;
      - max 90-day range;
      - default range: last 30 days ending at server-local today.

- Storage:
  - Add SQLite table `watcher_logs`:
    - `id`;
    - `watcher_id` FK to `watchers.id`;
    - `outcome`;
    - `observed_at`;
    - `note`;
    - `created_at`.
  - Persist manual B watcher as:

```json
{
  "type": "manual_exogenous",
  "sourceLabel": "공지 페이지",
  "sourceUrl": "https://example.org/notices",
  "sourceStability": "stable"
}
```

  - `watchers.kind='B'`, `armed=1`, `threshold=null`.

- Output:
  - `POST /api/watchers/manual-exogenous`
    - Returns `{ watcher, manualExogenous }`.
  - `POST /api/watchers/:id/manual-log`
    - Returns `{ log, summary }`.
    - `summary` includes counts for that watcher in the default 30-day window.
  - `GET /api/watchers?date&now`
    - Manual B rows remain visible in `/watch`.
    - They never surface as Today due bubbles in this cycle.
    - `WatcherDeepRow` includes optional `manualExogenous` object for B rows:
      source fields, last log, counts, and source stability.
  - `GET /api/mirror/automation-needs?from&to`
    - Returns `{ range, items, sampleStatus }`.
    - Each item includes:
      - watcher id/label/category/source stability;
      - `manualLogCount`;
      - `signalSeenCount`;
      - `missedSignalCount`;
      - `missRate`;
      - `level: quiet | watch | consider_lightweight`;
      - `reasonCodes` and human-readable technical reasons.
    - No automatic action and no crawler setup.

- Deterministic derivation:
  - Only `watcher_logs` and manual-exogenous watcher metadata are used.
  - Cold start: fewer than 3 logs for a watcher => low-sample reason, never
    `consider_lightweight`.
  - `missRate = missedSignalCount / max(1, signalSeenCount + missedSignalCount)`.
  - `consider_lightweight` only when:
    - manualLogCount >= 3;
    - missedSignalCount >= 1;
    - missRate >= 0.34;
    - sourceStability is `stable`.
  - `volatile` sources never produce stronger than `watch`.
  - Output is descriptive, not prescriptive.

- Failure:
  - Invalid input returns stable `VALIDATION_ERROR`.
  - Unknown watcher id returns `NOT_FOUND`.
  - Logging a non-manual-exogenous watcher returns `WRONG_WATCHER_TYPE`.
  - DB write failure rolls back the log insert.
  - Malformed stored manual-exogenous rule is shown as `unsupported` in `/watch`
    and ignored by Mirror automation-needs.

## Key Changes

- Shared:
  - Extend `shared/src/watchers.ts` with strict schemas/types:
    - `CreateManualExogenousWatcherRequestSchema`;
    - `ManualExogenousRuleSchema`;
    - `CreateWatcherManualLogRequestSchema`;
    - `WatcherManualLogSchema`;
    - `ManualExogenousViewSchema`;
    - optional `manualExogenous` on `WatcherDeepRowSchema`.
  - Extend or add `shared/src/mirror.ts` schemas/types:
    - `MirrorAutomationNeedsQuerySchema`;
    - `AutomationNeedLevelSchema`;
    - `MirrorAutomationNeedItemSchema`;
    - `MirrorAutomationNeedsDataSchema`;
    - strict schemas reject injected `score`, `recommendation`, `advice`.

- Backend:
  - Add Drizzle schema + migration for `watcher_logs`.
  - Extend watcher repository:
    - create manual-exogenous watcher;
    - insert watcher log in transaction;
    - read log summaries by watcher id and by range;
    - fetch recent manual B log data for `/watch`.
  - Extend `server/src/routes/watchers.ts`:
    - `POST /api/watchers/manual-exogenous`;
    - `POST /api/watchers/:id/manual-log`;
    - keep date-threshold/reverse-plan/snooze/armed/list behavior unchanged.
  - Add pure service, for example `server/src/services/watcher-manual-exogenous.ts`:
    - parse/validate manual-exogenous rule JSON;
    - build `/watch` view object from watcher row + log summary;
    - no DB, no LLM, no network.
  - Add pure service, for example `server/src/services/mirror-automation-needs.ts`:
    - derive levels/reasons from watcher metadata + log rows;
    - no DB, no LLM, no network.
  - Extend `server/src/routes/mirror.ts`:
    - `GET /api/mirror/automation-needs?from&to`.
  - Today and daily push:
    - Manual B watchers must not enter `evaluateWatcherA`/push due surfaces.

- Frontend:
  - Extend `web/src/Watchers.tsx`:
    - create sheet adds third mode: `수동 외생`;
    - fields: label, optional category, source label, source URL, source
      stability;
    - manual B card shows source, stability, last log, counts;
    - buttons for `checked_no_signal`, `signal_seen`, `missed_signal`;
    - log failure keeps row visible with `role="alert"`;
    - no free-text note in first UI slice unless existing form complexity stays
      small.
  - Extend `/mirror` screen:
    - fetch `GET /api/mirror/automation-needs` with existing range behavior or
      default range;
    - show "자동화 필요 신호" section;
    - quiet/low-sample wording stays descriptive, not advisory pressure;
    - links back to `/watch`.
  - UI constraints:
    - semantic tokens only;
    - touch targets at least 44px;
    - reduced-motion safe;
    - all loading/quiet/live/error/access-session states preserved.

- Docs:
  - Update `docs/codebase-map.md` with:
    - corrected reverse-plan POST response shape;
    - new `watcher_logs` table;
    - manual-exogenous watcher routes/service/repository boundaries;
    - Mirror automation-needs route/service/UI section.

## Sprint Contract

- Pass criteria:
  - Manual B watcher creation persists `kind='B'`, `armed=1`, `threshold=null`,
    and strict `manual_exogenous` rule JSON.
  - Manual B watcher appears in `/watch` and never appears in Today or daily
    push in this cycle.
  - Manual log insert is transactional and only allowed for manual-exogenous
    watchers.
  - Invalid injected fields are rejected by shared schemas and routes.
  - Mirror automation-needs derives levels deterministically from logs and source
    stability.
  - Cold-start and volatile-source cases never overstate automation readiness.
  - Mirror output contains reasons and requires no confirmation/action mutation.
  - No LLM, GCal, Gmail, crawler, n8n, fetch, or external network dependency is
    introduced.
  - Existing date-threshold, reverse-plan, Today watcher bubbles, and daily push
    behavior remain compatible.
  - `docs/codebase-map.md` updated and stale reverse-plan response shape fixed.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm verify`
  - `git diff --check master..HEAD`
  - Static boundary check for no LLM/GCal/Gmail/crawler/n8n/fetch imports in new
    manual-exogenous and automation-needs paths.

- Test cases:
  - Unit:
    - strict manual-exogenous request rejects unknown `score`/`recommendation`;
    - strict manual log request rejects unknown fields and invalid outcome;
    - malformed manual-exogenous rule returns unsupported/null;
    - automation level low sample;
    - stable source + enough logs + miss rate threshold => consider_lightweight;
    - volatile source + same misses => watch only;
    - zero signal denominator produces missRate 0, not NaN.
  - SQLite integration:
    - migration creates `watcher_logs` with FK/check constraints;
    - create manual B watcher success;
    - log insert success returns summary;
    - log insert for unknown watcher => 404;
    - log insert for date-threshold/reverse-plan watcher => wrong type;
    - invalid injected fields => `VALIDATION_ERROR`;
    - `/api/watchers` includes manualExogenous view;
    - `/api/today` and watcher daily push exclude manual B rows;
    - `/api/mirror/automation-needs` returns deterministic range/items.
  - Web:
    - `/watch` existing date-threshold and reverse-plan create still work;
    - manual-exogenous create posts exact body;
    - manual B card renders source/stability/counts;
    - log buttons post exact outcomes and refetch/update;
    - log failure shows row-level alert;
    - `/mirror` renders automation-needs section in loading/quiet/live/error
      paths as appropriate;
    - semantic token check for new CSS.
  - Manual:
    - Mobile/light/dark/reduced-motion source or headless evidence recorded if
      UI files change.

- gas limit: N/A
- slither pass: N/A

## 누락된 엣지 케이스 후보 3개

- Manual B watcher rule is malformed or from a future schema version. Expected:
  `/watch` shows unsupported and Mirror ignores it.
- User logs many `checked_no_signal` rows but no actual signal/miss rows.
  Expected: frequency is visible, but missRate remains 0 and no automation
  readiness is overstated.
- A manual log is inserted exactly at range boundary. Expected: date filtering
  uses `observedAt.slice(0,10)` consistently and includes both endpoints.

## 더 단순한 대안 1개

Only add a free-text note field on watcher cards and count note frequency in
Mirror. Rejected because it cannot distinguish "checked, no signal" from
"missed signal"; FR-MIR-05 specifically needs missed-rate signal, not just
activity volume.

## Assumptions

- Existing `watchers.kind` enum already supports `B`; no watcher enum migration
  is needed.
- A new `watcher_logs` table is acceptable because existing `annotations` are
  event-bound and cannot honestly represent watcher observations.
- Source stability is user-authored, not inferred.
- Mirror automation-needs is read-only and does not create crawlers, jobs, or
  watcher-B automation.
- Manual browser checks may be replaced by explicit headless/source evidence if
  browser access is unavailable; record the limitation in RESOLVED if needed.

## Review Guidance

### Enumeration 필요 항목

- Watcher rule consumers:
  - Search: `rg -n "date_threshold|reverse_plan|manual_exogenous|parse.*Rule|rule" server/src shared/src web/src`
  - Verify manual-exogenous rules do not break existing date-threshold or
    reverse-plan rule parsing.

- Today/push boundaries:
  - Search: `rg -n "evaluateWatcherA|selectDueForPush|findWatchersForPush|WatcherABubble" server/src shared/src`
  - Verify kind B manual watchers never surface in Today or daily push.

- Mirror route/schema boundaries:
  - Search: `rg -n "mirror|Mirror.*Schema|/api/mirror" server/src shared/src web/src`
  - Verify new automation-needs schemas are strict and read-only.

- External dependency boundary:
  - Search:
    `rg -n "completeChat|LLM_PROXY_BASE_URL|googleapis|gcal|gmail|crawler|n8n|fetch\\(" server/src/services server/src/routes shared/src web/src`
  - Expected in new manual-exogenous/automation-needs path: no hits except
    normal frontend API calls from page code.

### 검증 방식 가이드

- DB migration/table constraints:
  - Mock tests are insufficient.
  - Use SQLite integration tests with real temporary DB and migrated schema.

- Transaction and FK behavior:
  - Mock tests are insufficient.
  - Force invalid watcher id / wrong watcher type / check constraint failures
    against real SQLite.

- Automation-needs derivation:
  - Pure unit tests sufficient for level/reason math.
  - Route integration needed for date-range filtering and DB row mapping.

- UI:
  - JSDOM tests required for create/log/error states.
  - Manual browser checks may be replaced by recorded source/headless evidence
    only if browser access is unavailable.

- Scope creep:
  - Any crawler, network fetch, scheduler, push channel, LLM call, or automatic
    mutation from Mirror is outside this plan and should block review.
