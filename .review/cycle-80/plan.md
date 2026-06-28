# Manual Transit Detail Capture A Implementation Plan

Branch: feature/cycle-80-manual-transit-detail-capture-a
Cycle: 80
Created: 2026-06-28
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 80 promotes **Manual Transit Detail Capture A** from
`docs/naver-directions-roadmap-cycles-77-79.md`.

Cycle 78 already stores an optional `note` on `pinned_transit_facts`, but that
note is not yet first-class in the Today transition evidence: `TransitionTravel`
only surfaces the pinned duration, and the add/update form does not prefill the
current pinned duration/note. This cycle closes that gap by carrying the manual
detail note through the existing pinned transit path and rendering it next to
the pinned travel evidence.

The key boundary is: this is user-authored manual detail for an existing pinned
public-transit fact. It is not provider-fetched route data, not Naver scraping,
not route-step parsing, and not a new feasibility input beyond the existing
duration minutes.

## Input/Output Spec

- Input:
  - Existing `pinned_transit_facts.note` from Cycle 78.
  - Existing `PUT /api/transit-facts/pair` request with optional `note`.
  - Existing route-level `buildDayTravelFacts` pinned fact precedence.
  - Existing Today transition rows and pinned transit add/update form.
- Normal output:
  - Extend provider-neutral `TransitionTravel` with an optional manual detail
    field:
    - Proposed: `note?: string | null`
    - Only meaningful when `source === "pinned_user"`.
    - Max length remains aligned with `UpsertPinnedTransitRequest.note` (200).
  - When a pinned transit fact has a nonblank note, the day travel builder
    includes it in the pinned `TransitionTravel` evidence.
  - Today transition rows render pinned evidence as:
    - `고정 이동 약 8분`
    - plus compact detail copy such as `9호선 1정거장`
  - The detail copy is visually quiet and provenance-consistent with the pinned
    duration; it must not look like live provider data.
  - Opening the existing "고정 이동시간 수정" form for a pinned fact pre-fills:
    - duration from current pinned travel evidence;
    - note from current pinned travel evidence.
  - Submitting the form continues to use `PUT /api/transit-facts/pair`; no new
    route is required.
  - Existing feasibility math still uses only `durationMinutes * travelMargin`.
    The note never changes gap math, sequence energy, ordering, or scheduling.
- Failure behavior:
  - Missing note remains `null`/absent and renders no extra detail line.
  - Too-long note is still rejected by the existing shared request schema/server
    validation.
  - Provider travel evidence (`source` absent or `provider`) must not accept or
    render a manual note as if it came from a provider.
  - Search/provider/Naver failures remain unrelated to this flow.
  - No DB schema/migration, new table, route scraping, provider API call, or
    schedule mutation is introduced.

## Key Changes

- Shared:
  - `shared/src/feasibility.ts`
    - Add optional `note: z.string().max(200).nullable().optional()` to
      `TransitionTravelSchema`.
    - Keep existing payloads backward compatible.
    - Keep `.strict()` so raw route-step/provider fields remain rejected.
  - `shared/src/feasibility.test.ts`
    - Accept pinned travel with `source: "pinned_user"` and `note`.
    - Reject injected route details such as `subwayLine`, `busRoute`, `fare`,
      `arrival`, `steps`, or raw provider payloads.
- Backend:
  - `server/src/services/travel-time.ts`
    - Include `p.note` when creating pinned `TransitionTravel` evidence.
    - Trim/normalize blank notes to `null` or omit them consistently.
    - Do not include notes on provider/cache travel evidence.
  - Tests:
    - Existing travel-time integration test for pinned evidence should assert
      note propagation.
    - Route integration test for Today or feasibility should prove a pinned note
      appears in transition travel evidence while gap math remains based only on
      duration.
- Frontend:
  - `web/src/Today.tsx`
    - Render manual transit note next to the pinned travel line when present.
    - Prefill the pinned transit form from current pinned travel evidence when
      updating an existing pinned fact.
    - Keep add flow blank when no pinned fact exists.
    - Keep Cycle 77 Naver "길찾기" link and Cycle 79 place search behavior
      unchanged.
  - `web/src/Today.test.tsx`
    - Cover pinned note rendering (`고정 이동 약 8분` + `9호선 1정거장`).
    - Cover update form prefill for duration/note.
    - Cover blank/no-note pinned fact rendering without a stray empty note line.
    - Cover provider travel evidence does not render manual detail.
  - `web/src/styles.css`
    - Add semantic-token-only compact style for manual transit detail if needed;
      no new color family or alert styling.
- Docs:
  - `docs/naver-directions-roadmap-cycles-77-79.md`
    - Mark Cycle 79 merged and Cycle 80 promoted/active.
  - `docs/codebase-map.md`
    - Update after implementation with the manual transit detail propagation and
      Today UI behavior.

## Sprint Contract

- Passing criteria:
  - Existing `pinned_transit_facts.note` is propagated into
    `TransitionTravel.note` for pinned user facts.
  - `TransitionTravel.note` is optional/backward-compatible and strict; route
    steps, provider raw payloads, fare/arrival fields, score/recommendation, and
    auto-apply fields remain rejected.
  - Today renders manual transit detail only for pinned user facts with a
    nonblank note.
  - Existing pinned transit update form pre-fills duration and note when editing
    an existing pinned fact.
  - New pinned transit form remains blank when no pinned fact exists.
  - Feasibility gap math, sequence energy, transition cost classification,
    Naver directions links, Naver place search, event detail geocode preview,
    and pinned transit upsert route semantics remain unchanged.
  - No DB schema/migration, new table, new route, Naver API call, route scraping,
    route-step parsing, schedule mutation, cron job, or LLM path is introduced.
  - `docs/codebase-map.md` reflects the note propagation after implementation.
- Automatic checks:
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:integration`
  - `corepack pnpm build`
  - `corepack pnpm verify`
  - `git diff --check master...HEAD`
  - Static negative checks:
    - No schema/migration/new-route scope:
      `git diff --name-only master...HEAD | rg 'server/drizzle|server/src/db/schema.ts|server/src/routes/.*transit|server/src/routes/.*places'`
      should have no implementation matches.
    - No route scraping/provider result parsing:
      `git diff -U0 master...HEAD -- server shared web docs | rg -n 'scrap|crawler|cheerio|jsdom|fare|arrival|subwayLine|busRoute|route step|transit result|steps'`
      should have no implementation matches except schema rejection tests/docs.
    - No hidden schedule mutation:
      `git diff -U0 master...HEAD -- server shared web | rg -n 'auto.?resched|schedule automatically|PATCH /api/events/.*/schedule|apply.*schedule|cron|bulk'`
      should have no implementation matches except negative docs/tests.
    - No LLM path:
      `git diff -U0 master...HEAD -- server/src shared/src web/src | rg -n 'llm|chat/completions|Grok|prompt'`
      should have no manual transit detail implementation matches.
- Test cases:
  - Shared schema accepts pinned travel with `note: "9호선 1정거장"`.
  - Shared schema rejects injected route-step/provider fields.
  - Travel-time service converts pinned fact note into pinned transition travel
    evidence.
  - Pinned note does not alter duration/gap required-minute math beyond the
    existing pinned duration.
  - Today transition row renders pinned duration + note.
  - Today transition row with pinned duration and no note renders no extra detail
    line.
  - Provider travel estimate with a note-like injected field is rejected or not
    rendered as manual detail.
  - Existing pinned upsert submit still sends only event ids, duration, and note.
  - Existing Cycle 77 Naver directions and Cycle 79 place-search tests still
    pass.
- gas limit: N/A
- slither pass: N/A

## Missing Edge Case Candidates

- Existing pinned facts may have `note` as `null`, empty string, or whitespace if
  data was inserted manually. The service/UI should treat blank notes as absent.
- A provider travel fact should never display a manual detail note. The UI should
  gate note rendering on `source === "pinned_user"`.
- Editing an existing pinned fact should not force the user to retype the note.
  Prefill is part of the contract, not a nice-to-have.

## Simpler Alternative

Do nothing: Cycle 78 already lets the user type a note. This is not enough
because the note is hidden from the operational transition surface and the edit
form does not prefill the existing value. The adopted plan reuses the existing
storage and route, adding only evidence propagation and UI polish.

## Assumptions

- `pinned_transit_facts.note` is the canonical manual transit detail field for
  the A version.
- A single free-text note is enough for "9호선 1정거장, 약 8분"; structured
  fields such as line, stop count, walking minutes, or fare are intentionally
  deferred.
- The duration remains the only numeric input to feasibility. Manual detail is
  explanatory context.

## Review Guidance

### Enumeration Needed

- Pinned transit evidence path:
  - Search: `rg -n 'pinnedEvidence|travel_pinned_transit|source: "pinned_user"|TransitionTravel|note' server/src/services/travel-time.ts shared/src/feasibility.ts web/src/Today.tsx`
  - Expected: pinned notes are propagated only from pinned facts to pinned travel
    evidence and rendered only for pinned facts.
- Pinned transit form path:
  - Search: `rg -n 'PinFormState|고정 이동시간|durationMinutes|note|transit-facts/pair' web/src/Today.tsx web/src/Today.test.tsx`
  - Expected: editing a pinned fact pre-fills duration/note; submit payload shape
    remains event ids + duration + note only.
- Scope boundary:
  - Search: `git diff --name-only master...HEAD`
  - Expected: no DB migration/schema route additions. Changes should be limited
    to shared schema/tests, travel-time service/tests, Today UI/tests/styles,
    docs/review.

### Verification Method Guide

- Schema contract:
  - Shared unit tests are sufficient for optional note acceptance and injected
    field rejection.
- Backend propagation:
  - Service/integration tests are required because the note originates in DB
    pinned facts and must reach route-level travel evidence.
- Frontend behavior:
  - Vitest coverage is required for rendering, no-note omission, provider
    gating, and edit prefill.
- Negative provider/scraping boundary:
  - Static negative checks are required. Mock tests alone do not prove no route
    parsing or provider ingestion was added.
