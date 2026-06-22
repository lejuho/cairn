# Feasibility Params UI Implementation Plan

Branch: feature/cycle-31-feasibility-params-ui
Skills: backend-fastify, frontend-react-pwa

## Summary

Cycle 31 implements the first useful FR-FEAS-03 slice: the user can view,
preview, and persist the deterministic feasibility parameters that already feed
Today, `/api/feasibility/day`, and Mirror energy trends.

Current state:

- `params` table exists and `readNumericParam` already feeds:
  - `energy_budget`
  - `meet_buffer`
  - `deep_buffer`
  - `travel_margin`
  - `max_continuous`
- Today already renders a `FeasibilityPanel` from `TodaySurface.feasibility`.
- There is no route or UI for editing these params.

This cycle adds a conservative "adjust → preview → apply" loop. Slider changes
produce a read-only preview for the currently loaded Today date/time. Only the
explicit apply action writes to SQLite.

Out of scope:

- `deficit_mode` behavior;
- recovery/sleep/meal model;
- overrun history correction (FR-FEAS-07);
- live travel/weather shock recalculation (FR-FEAS-05);
- slot scoring changes;
- Mirror-specific controls;
- offline write queueing;
- migration, unless implementation proves the existing `params` table is
  insufficient.

## Input/Output Spec

- Input:
  - `GET /api/feasibility/params`
    - No query body.
    - Returns the current effective params plus slider metadata.
  - `PUT /api/feasibility/params`
    - Body is a full replacement:

```json
{
  "energyBudget": 8,
  "meetBufferMinutes": 15,
  "deepBufferMinutes": 30,
  "travelMargin": 1,
  "maxContinuousMinutes": 600
}
```

  - `POST /api/feasibility/day/preview`
    - Read-only body:

```json
{
  "date": "2026-06-22",
  "now": "2026-06-22T09:00:00+09:00",
  "params": {
    "energyBudget": 8,
    "meetBufferMinutes": 15,
    "deepBufferMinutes": 30,
    "travelMargin": 1,
    "maxContinuousMinutes": 600
  }
}
```

- Output:
  - `GET /api/feasibility/params`
    - `200 { ok: true, data: FeasibilityParamSettingsData }`
    - Proposed shape:

```json
{
  "params": {
    "energyBudget": 8,
    "meetBufferMinutes": 15,
    "deepBufferMinutes": 30,
    "travelMargin": 1,
    "maxContinuousMinutes": 600
  },
  "defaults": {
    "energyBudget": 8,
    "meetBufferMinutes": 15,
    "deepBufferMinutes": 30,
    "travelMargin": 1,
    "maxContinuousMinutes": 600
  },
  "limits": {
    "energyBudget": { "min": 1, "max": 16, "step": 0.5, "unit": "h" },
    "meetBufferMinutes": { "min": 0, "max": 120, "step": 5, "unit": "min" },
    "deepBufferMinutes": { "min": 0, "max": 180, "step": 5, "unit": "min" },
    "travelMargin": { "min": 0.5, "max": 3, "step": 0.1, "unit": "x" },
    "maxContinuousMinutes": { "min": 60, "max": 960, "step": 30, "unit": "min" }
  }
}
```

  - `PUT /api/feasibility/params`
    - `200 { ok: true, data: FeasibilityParamSettingsData }`
    - Persists canonical DB keys:
      - `energy_budget`
      - `meet_buffer`
      - `deep_buffer`
      - `travel_margin`
      - `max_continuous`
    - Write is atomic: either all five params are updated or none are.
  - `POST /api/feasibility/day/preview`
    - `200 { ok: true, data: DayFeasibility }`
    - No writes. Uses supplied params only for the preview computation.
  - Failure:
    - Invalid number, missing key, out-of-range value, malformed date, or
      malformed `now` returns HTTP 400 with `VALIDATION_ERROR`.

## Key Changes

- Shared:
  - Extend `shared/src/feasibility.ts` with:
    - `UpdateFeasibilityParamsRequestSchema` for full replacement;
    - `FeasibilityParamLimitSchema`;
    - `FeasibilityParamSettingsDataSchema`;
    - `FeasibilityParamSettingsResponseSchema`;
    - `PreviewFeasibilityRequestSchema`;
    - exported types for all of the above.
  - Keep persisted/calculation values numeric. Do not introduce stringly typed
    params in shared contracts.
  - Add shared unit tests for:
    - valid settings response;
    - out-of-range values rejected;
    - missing replacement keys rejected;
    - injected `score`, `recommendation`, or unknown fields rejected if schemas
      are strict.

- Backend:
  - Add a small deterministic params service, for example
    `server/src/services/feasibility-params.ts`:
    - owns default values, slider limits, DB key mapping, and canonical string
      serialization;
    - reads effective params with existing `readNumericParam`;
    - writes all five keys atomically with `upsertParam` inside a SQLite
      transaction;
    - never calls LLM or external network.
  - Extend `server/src/routes/feasibility.ts` with:
    - `GET /api/feasibility/params`;
    - `PUT /api/feasibility/params`;
    - `POST /api/feasibility/day/preview`.
  - Keep handlers thin: validate shared schema → call params service or
    `computeDayFeasibility` → return typed response.
  - Ensure existing `GET /api/feasibility/day`, `GET /api/today`, and Mirror
    energy trends keep reading the same persisted DB keys.
  - Add route integration tests against a real temporary SQLite DB.
  - No migration expected; `corepack pnpm db:generate` should report no schema
    changes.

- Frontend:
  - Update `web/src/Today.tsx`:
    - add a "조정" action to `FeasibilityPanel`;
    - open a bottom sheet with five sliders and live numeric values;
    - fetch `GET /api/feasibility/params` on open, using current surface params
      as an immediate fallback while loading;
    - on slider change, update draft values and request a read-only preview via
      `POST /api/feasibility/day/preview`;
    - render the preview energy/gap result inside the sheet without mutating
      Today state;
    - apply button calls `PUT /api/feasibility/params`, then refreshes Today;
    - cancel/backdrop/Escape closes without mutation;
    - save/preview failures keep the sheet open and show local error.
  - Use semantic tokens only. Slider thumb target follows
    `docs/cairn-design-system.md`: thumb 22px, touch target at least 44px,
    adjacent mono numeric value.
  - Preserve existing Today loading, quiet, live, error, access-session states.
  - Do not introduce offline write semantics.

- Docs:
  - Update `docs/codebase-map.md` with:
    - new shared feasibility params contracts;
    - params service ownership;
    - new feasibility routes;
    - Today feasibility settings sheet behavior.

## Sprint Contract

- Pass criteria:
  - `GET /api/feasibility/params` returns current effective params, defaults,
    and slider limits.
  - `PUT /api/feasibility/params` validates all five values and persists the
    canonical DB keys atomically.
  - Out-of-range, missing, NaN/Infinity, or non-number values return stable
    `400 VALIDATION_ERROR` and do not partially write.
  - `POST /api/feasibility/day/preview` computes `DayFeasibility` using supplied
    params and does not write to `params`.
  - Existing Today, `/api/feasibility/day`, and Mirror energy trend calculations
    observe persisted params after save.
  - Today settings sheet shows five sliders with live values.
  - Slider changes request preview without persisting.
  - Apply persists and refreshes Today.
  - Cancel/close does not persist.
  - Failed preview or save keeps the sheet open and shows a local error.
  - Access-session behavior remains consistent with existing `apiJson` flows.
  - No LLM, cron, external network, or migration is introduced.
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
    - valid settings response parses;
    - valid full replacement parses;
    - missing keys rejected;
    - out-of-range values rejected for each param;
    - injected `score`/`recommendation`/unknown fields rejected if schema is
      strict;
    - preview request validates date/now/params.
  - Backend unit:
    - params service maps DB snake_case keys to shared camelCase fields;
    - malformed stored values fall back to defaults on read;
    - canonical serialization is stable (`8`, `15`, `1.2`, etc.).
  - Backend integration:
    - `GET /api/feasibility/params` returns defaults with empty DB;
    - `PUT /api/feasibility/params` writes all five keys;
    - invalid update does not partially write any key;
    - `POST /api/feasibility/day/preview` changes returned energy/gap params but
      does not change persisted DB rows;
    - existing `GET /api/feasibility/day` reflects saved values;
    - `GET /api/today` reflects saved values;
    - Mirror energy trend route reflects saved `energy_budget` at minimum.
  - Frontend:
    - Today live state renders feasibility "조정" action;
    - opening settings fetches current params and renders five sliders;
    - slider change shows updated draft value and calls preview route;
    - preview result renders without changing the underlying Today surface;
    - apply calls PUT, closes or returns to Today, and refreshes Today;
    - cancel closes without PUT;
    - preview/save failure keeps sheet open with alert;
    - loading/quiet/error/access-session states still pass.
  - Manual checks:
    - mobile and wide `/today`;
    - light and dark themes;
    - keyboard focus through open, sliders, apply, cancel, and close;
    - 44px targets and reduced-motion behavior.

- gas limit: N/A
- slither pass: N/A

## Three Missing Edge-Case Candidates

- A user drags a slider quickly. Preview requests may return out of order; the
  UI must ignore stale preview results or otherwise keep the latest draft
  visible.
- A persisted DB value is malformed (`energy_budget="abc"`). Read should fall
  back to defaults, and opening the settings sheet should not crash.
- Apply succeeds but the subsequent Today refresh fails. The UI should not
  silently claim the visible Today surface has recalculated; show a scoped
  refresh error or keep a clear pending/error state.

## Simpler Alternative

Add only `PUT /api/feasibility/params` and make sliders save immediately on
change. This is smaller, but it creates accidental writes while the user is
exploring values. The preview route keeps deterministic recalculation visible
without mutating decisions until the user explicitly applies.

## Assumptions

- The existing `params` table is sufficient; no schema migration is expected.
- These initial ranges are safe A-level product limits:
  - `energyBudget`: 1..16, step 0.5
  - `meetBufferMinutes`: 0..120, step 5
  - `deepBufferMinutes`: 0..180, step 5
  - `travelMargin`: 0.5..3, step 0.1
  - `maxContinuousMinutes`: 60..960, step 30
- `deficit_mode` is not implemented until a future cycle defines its behavior.
- Preview recalculates the currently loaded Today date/time only; broader slot
  scoring and Mirror-specific refresh are future cycles.
- Browser manual checks may be recorded as limitation + automated/code evidence
  if execution is headless, but the limitation must be explicit.

## Review Guidance

### Enumeration Required

- Shared feasibility contracts:
  - Search:
    `rg -n "FeasibilityParam|UpdateFeasibility|PreviewFeasibility|DayFeasibility" shared/src/feasibility.ts shared/src/*feasibility*.test.ts`
  - Expected: update/preview/settings schemas exist and reject invalid ranges or
    injected score/advice fields.

- Backend params ownership:
  - Search:
    `rg -n "feasibility.*params|energy_budget|meet_buffer|deep_buffer|travel_margin|max_continuous|upsertParam|readNumericParam" server/src`
  - Expected: one service owns default/range/key mapping; routes stay thin;
    all persisted writes use the canonical keys.

- Atomic write guarantee:
  - Search:
    `rg -n "transaction|upsertParam|PUT /api/feasibility/params|feasibility/params" server/src server/src/routes/*.integration.test.ts`
  - Expected: invalid updates do not leave partial DB writes. Mock tests are not
    sufficient; use real SQLite integration.

- Preview no-write boundary:
  - Search:
    `rg -n "preview|upsertParam|insert\\(|update\\(|delete\\(" server/src/routes/feasibility.ts server/src/services/feasibility-params.ts server/src/routes/*feasibility*.test.ts`
  - Expected: preview path computes with supplied params and does not mutate
    `params`.

- Today UI behavior:
  - Search:
    `rg -n "FeasibilityPanel|조정|feasibility/params|feasibility/day/preview|slider|range" web/src/Today.tsx web/src/Today.test.tsx web/src/styles.css`
  - Expected: sheet, five sliders, preview, apply, cancel, and error states are
    covered.

- No LLM/external dependency:
  - Search:
    `rg -n "completeChat|createLlmGateway|LLM_PROXY_BASE_URL|fetch\\(" server/src/routes/feasibility.ts server/src/services/feasibility-params.ts`
  - Expected: no LLM or external network call in params/preview server paths.

- Codebase map:
  - Search:
    `rg -n "feasibility/params|day/preview|FeasibilityParam|Feasibility settings" docs/codebase-map.md`
  - Expected: new route/service/shared/UI entries are documented.

### Verification Method Guide

- Schema/range validation:
  - Shared unit tests are enough for pure schema behavior.

- SQLite persistence, atomicity, and existing route integration:
  - Mock tests are insufficient.
  - Use real temporary SQLite integration tests and inspect DB rows before/after
    invalid writes and preview calls.

- Preview computation:
  - Route integration should prove supplied params affect returned
    `DayFeasibility.params` and energy budget while persisted DB values remain
    unchanged.

- UI interactions:
  - Vitest/JSDOM tests are sufficient for sheet open/close, sliders, preview,
    apply, cancel, save failure, preview failure, and access-session handling.

- Manual UI:
  - Manual mobile/wide, light/dark, keyboard, 44px, and reduced-motion checks
    are required, or an explicit headless limitation plus concrete automated/code
    evidence must be recorded in RESOLVED.
