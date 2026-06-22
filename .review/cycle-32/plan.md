# Slot Suggestion B Implementation Plan

Branch: feature/cycle-32-slot-suggestion-b
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 32 upgrades the existing slot suggestion flow from "first free windows" to
"ranked candidates with decomposed reasons".

Current state:

- `GET /api/events/:id/slot-candidates` exists for unscheduled Cairn events.
- `generateSlotCandidates` checks fixed windows, skips overlaps, and returns up
  to 3 candidates with a single `free_window` reason.
- Today renders `schedule_prompt` cards, loads candidates, and schedules the
  selected candidate through `PATCH /api/events/:id/schedule`.
- Cycle 31 added editable feasibility params and a Today settings sheet.
- People profiles can store hard preferred weekdays/periods and hard
  unavailable weekdays.
- Mirror pattern and energy APIs already expose historical evidence, but slot
  suggestions do not yet use that evidence.

This cycle implements the next useful FR-SLOT slice:

- score and sort candidate slots deterministically;
- show decomposed reasons by lens: availability, feasibility, people, friction;
- connect reason lenses to existing adjustment surfaces where possible.

Out of scope:

- natural-language scheduling requests;
- new `/slots` page;
- offline write queueing;
- travel-time oracle or live weather/traffic;
- overrun-history correction;
- automatic conflict resolution when no free slots exist;
- notification drafts after scheduling;
- new DB tables or migrations unless implementation proves current data is
  insufficient.

## Input/Output Spec

- Input:
  - `GET /api/events/:id/slot-candidates?date=YYYY-MM-DD&now=<RFC3339>&days=N`
    - Same route and eligibility rules as the current Slot A endpoint.
    - `:id` must be an unscheduled Cairn planned event.
    - `days` remains `1..14`, default `7`.
  - `PATCH /api/events/:id/schedule`
    - Unchanged. Takes selected candidate `{ start, end }`.

- Output:
  - `GET /api/events/:id/slot-candidates`
    - Returns the same event plus enriched candidate rows.
    - Proposed candidate shape:

```json
{
  "start": "2026-06-23T09:00:00+09:00",
  "end": "2026-06-23T10:00:00+09:00",
  "score": 82,
  "rank": 1,
  "scoreLabel": "좋음",
  "reasons": [
    "겹치는 일정 없음",
    "체력 예산 안",
    "관련자 선호 시간과 맞음",
    "과거 표본 부족 — 마찰 보정 없음"
  ],
  "reasonCodes": [
    "free_window",
    "energy_within_budget",
    "person_preferred_window",
    "friction_low_sample"
  ],
  "contributions": [
    {
      "lens": "availability",
      "label": "겹침",
      "impact": "positive",
      "points": 40,
      "confidence": "observed",
      "reasonCodes": ["free_window"],
      "evidence": ["09:00–10:00 사이 겹치는 일정 없음"]
    },
    {
      "lens": "feasibility",
      "label": "체력",
      "impact": "positive",
      "points": 25,
      "confidence": "observed",
      "reasonCodes": ["energy_within_budget"],
      "evidence": ["예상 load 3.0h / 예산 8.0h"]
    }
  ]
}
```

  - Failure:
    - Existing 400/404/409 behavior remains stable.
    - Candidate scoring failure must fail open by omitting or neutralizing the
      affected lens, not by fabricating evidence.
    - No LLM, cron, network, or external API dependency.

## Key Changes

- Shared:
  - Extend `shared/src/slots.ts`:
    - add `SlotSuggestionLensSchema`:
      `availability | feasibility | people | friction`;
    - add `SlotSuggestionImpactSchema`:
      `positive | neutral | negative`;
    - add `SlotSuggestionConfidenceSchema`:
      `observed | cold_start | unavailable`;
    - add `SlotSuggestionContributionSchema` with strict fields:
      `lens`, `label`, `impact`, `points`, `confidence`, `reasonCodes`,
      `evidence`;
    - extend `SlotCandidateSchema` with `score`, `rank`, `scoreLabel`,
      `contributions`;
    - keep `reasons` and `reasonCodes` for compact Today rendering and backward
      readability.
  - Shared schemas must reject unknown fields such as `recommendation`,
    `advice`, or hidden mutation fields.

- Backend:
  - Refactor slot generation into a deterministic scoring pipeline, for example
    inside `server/src/services/slotCandidates.ts` or a small adjacent pure
    helper:
    - enumerate candidate windows as today does now;
    - reject overlaps exactly as Slot A does;
    - build a temporary candidate event for each surviving slot;
    - read current feasibility params with `readFeasibilityParamSettings`;
    - compute per-day feasibility with `computeDayFeasibility`;
    - read attached people via `findEventPeopleFullProfiles`;
    - evaluate people preferred windows and hard unavailable weekdays;
    - read historical annotation rows through the existing Mirror repository
      helper or a narrow new repository helper;
    - compute friction contribution by weekday, event type, and thread when
      sample exists; otherwise emit `friction_low_sample` neutral evidence;
    - sort by score desc, then start asc;
    - assign rank starting at 1 and cap response at 3 candidates.
  - Keep route handler thin:
    validate path/query with shared schemas, load event, check eligibility, call
    slot candidate service, return typed data.
  - Keep no-write guarantee for candidate fetch. Only `PATCH /schedule` mutates.
  - Do not call LLM gateway, Telegram, Gmail, GCal, or network.
  - No migration expected.

- Frontend:
  - Update `web/src/Today.tsx` schedule prompt rendering:
    - show each candidate as a tappable button with date/time and compact score
      label;
    - render 2-4 reason chips or lines from `contributions`;
    - preserve one-tap selection behavior;
    - add non-mutating reason links:
      - feasibility lens opens the existing feasibility settings sheet;
      - people lens links to the relevant people detail when evidence identifies
        a single person, otherwise stays descriptive;
      - friction lens can link to `/mirror` as the existing reflection surface;
    - keep empty/error states local to the card.
  - Preserve Today loading, quiet, live, error, and access-session states.
  - Use semantic tokens only. Candidate chips/buttons keep touch targets at
    least 44px and respect reduced motion.

- Docs:
  - Update `docs/codebase-map.md` with:
    - enriched slot candidate shared contracts;
    - slot scoring service responsibilities;
    - route behavior;
    - Today schedule prompt reason rendering and adjustment links.

## Sprint Contract

- Pass criteria:
  - `GET /api/events/:id/slot-candidates` still returns only free, future,
    non-overlapping candidate windows for eligible unscheduled Cairn events.
  - Candidate rows include `score`, `rank`, `scoreLabel`, `reasons`,
    `reasonCodes`, and `contributions`.
  - Contributions cover all four lenses when data is available:
    availability, feasibility, people, friction.
  - Missing people or insufficient friction history is explicit
    `cold_start`/`unavailable`, not hallucinated.
  - People preferred windows affect scoring and reason output.
  - Hard unavailable weekday for an attached person removes or negatively marks
    a candidate according to the implementation's documented rule; no candidate
    may be shown as "preferred" when it violates a hard unavailable weekday.
  - Feasibility params affect candidate scoring; saving params in Cycle 31
    changes subsequent candidate scores where relevant.
  - Historical flake/friction data affects scoring only when sample size is
    sufficient; low sample is shown as low confidence.
  - Sorting is deterministic: score desc, start asc.
  - Candidate fetch performs no DB writes.
  - `PATCH /api/events/:id/schedule` behavior remains unchanged.
  - Today card renders enriched reasons and keeps one-tap candidate selection.
  - Today card exposes feasibility/people/friction adjustment links without
    auto-mutating decisions.
  - No LLM, cron, external network, migration, or new primary route is
    introduced.
  - `docs/codebase-map.md` is updated.

- Automatic checks:
  - `corepack pnpm db:generate`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check`

- Test cases:
  - Shared unit:
    - valid enriched candidate response parses;
    - contribution lens/impact/confidence enums parse;
    - candidate rejects missing `score`, `rank`, or `contributions`;
    - unknown fields such as `recommendation`, `advice`, and mutation flags are
      rejected.
  - Backend unit:
    - free future candidate gets positive availability contribution;
    - overlap candidate is rejected;
    - feasibility deficit/tight gap lowers score and produces reason code;
    - people preferred weekday/period raises score and produces evidence;
    - hard unavailable weekday is not presented as preferred;
    - low friction sample emits neutral low-sample contribution;
    - sufficient historical slip data lowers score for matching weekday/type or
      thread;
    - deterministic tie-break sorts earlier start first.
  - Backend integration with real temporary SQLite DB:
    - eligible unscheduled Cairn event returns enriched candidates;
    - GCal or already scheduled event remains ineligible;
    - attached person preferred windows change candidate order;
    - persisted feasibility params change score output;
    - historical annotations change friction contribution when sample threshold
      is met;
    - candidate fetch does not write events, params, people, or annotations;
    - scheduling selected candidate still writes `start`/`end` once and rejects
      stale concurrent scheduling.
  - Frontend:
    - schedule prompt renders enriched candidate score label and reasons;
    - candidate click still calls `PATCH /api/events/:id/schedule`;
    - feasibility reason link opens the existing feasibility settings sheet;
    - people reason link navigates or renders accessible link when person
      evidence is present;
    - friction reason link points to `/mirror`;
    - candidate fetch failure keeps card visible with local alert;
    - existing Today loading/quiet/error/access-session tests still pass.
  - Manual checks:
    - mobile and wide `/today` schedule prompt;
    - light and dark themes;
    - keyboard focus through candidate buttons and reason links;
    - 44px targets and reduced-motion behavior;
    - no misleading "best" or auto-decision copy.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- A candidate satisfies people preference but creates an energy deficit after
  adding the temporary event.
- Historical friction sample is high for weekday but low for event type/thread;
  contribution must explain which lens had enough evidence.
- All candidates are filtered or heavily penalized by hard people constraints;
  the card must say why without silently hiding the whole prompt.

## Simpler Alternative

Only add prettier reason labels to current free-window candidates.

Rejected because it would not advance FR-SLOT-03/08/09: candidates would still
ignore feasibility params, people preference, and friction evidence, so the user
would see "why" text without real decision support.

## Assumptions

- Candidate duration remains the current 60-minute default for unscheduled
  events unless the existing event already carries enough duration metadata.
- Existing fixed candidate hours (`9, 11, 14, 16, 19`) remain the enumeration
  seed for this cycle.
- Friction scoring can reuse annotation/outcome history already available to
  Mirror; no new persistence is required.
- People preferred periods map to local start hour:
  morning `<12`, afternoon `12..17`, evening `>=18`.
- Score is an ordering aid, not an automatic decision. UI may display
  `scoreLabel`, but must keep reasons visible and require explicit tap to
  schedule.

## Review Guidance

### Enumeration Needed

- Slot shared contracts:
  - Search:
    `rg -n "SlotCandidate|SlotSuggestion|slot-candidates|recommendation|advice" shared/src shared/src/*.test.ts`
  - Expected: enriched candidate schema/types in `shared/src/slots.ts`; strict
    unknown-field rejection tests.

- Slot backend route/service:
  - Search:
    `rg -n "generateSlotCandidates|slot-candidates|readFeasibilityParamSettings|computeDayFeasibility|findEventPeopleFullProfiles|findAllOutcomeAnnotations" server/src`
  - Expected: route stays thin; scoring service owns deterministic ranking; no
    LLM/network imports.

- Candidate no-write boundary:
  - Search:
    `rg -n "scheduleEvent|upsertParam|insertStructuredAnnotation|insert|update|delete" server/src/routes/slots.ts server/src/services/slotCandidates.ts server/src/services/*slot*`
  - Expected: candidate fetch path does not call write helpers. Only schedule
    PATCH mutates.

- Today schedule prompt UI:
  - Search:
    `rg -n "schedule_prompt|slot-candidates|today-slot|SlotCandidate|feasibility settings|/mirror|/people" web/src/Today.tsx web/src/Today.test.tsx web/src/styles.css`
  - Expected: enriched reason rendering, one-tap scheduling preserved, local
    error state preserved, semantic styling.

- Docs map:
  - Search:
    `rg -n "slot-candidates|SlotCandidate|slot scoring|schedule prompt" docs/codebase-map.md`
  - Expected: shared/backend/frontend slot B ownership documented.

### Verification Method Guide

- Shared schema strictness:
  - Unit tests are sufficient.

- Deterministic scoring:
  - Pure unit tests are sufficient for arithmetic and ordering.

- DB read/write/no-write boundaries:
  - Real SQLite integration tests are required. Mock tests are insufficient
    because the review must verify event/params/people/annotation rows are not
    mutated by candidate fetch.

- Today reason rendering and adjustment links:
  - JSDOM component tests are required for rendering/click behavior.
  - Manual mobile/light/dark/reduced-motion checks remain required unless the
    executor records a headless limitation with concrete code/test evidence.

- LLM/network exclusion:
  - Static import/search check is sufficient plus automatic tests staying green
    without proxy setup.
