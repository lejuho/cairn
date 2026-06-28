# Step 001 — Approach check: Event Map Preview A (geocode fetch, preview state, render)

Cycle: 74
Pass: 1
Files Changed: (approach) — planned: web/src/Today.tsx(+test), web/src/styles.css, docs/*

## Advisor Verdict
PASS (1 NEEDS_REVIEW on render null-coord guard)

## Advisor Feedback
1. fetchEventGeocode PASS — header-less/body-less POST clears the route's no-body/no-query guard; EventGeocodeResponseSchema is the ok:true|false union, safeParse + throw-on-fail fine. 404/409 also return {ok:false,error} JSON → flow into the error branch (acceptable).
2. State machine PASS — tags cover all; selectedEventIdRef + render-time eventId===selectedEventId is correct. Requirement: update the ref SYNCHRONOUSLY in open/close (before any await), not in an effect.
3. Trigger/retry/close PASS — one POST per open after setEventDetail(loaded), none for blank. Retry must read location from CURRENT eventDetail.data.event.location at click time (not a stale open-closure). Close→idle reset; no Today/event mutation.
4. Render NEEDS_REVIEW — latitude/longitude AND displayLabel are nullable even for status:"resolved". Do NOT build `${lat},${lng}` unconditionally — if either null, fall back to authored-text query (never `null,null`); displayLabel→locationText fallback. Use data.locationText as the authored string. Rest (encodeURIComponent, api=1, rel=noopener, authored-text query for ambiguous/zero/failed, quiet cacheStatus) correct.
5. Risks PASS — schema carries no raw payload/url/key; keep providerStatus/providerResultId out of the link AND visible UI. Existing sheet behavior untouched; semantic tokens/44px/reduced-motion reused.

## Sonnet Response
- 적용 전부: fetchEventGeocode(body-less/header-less POST + schema safeParse); geocodePreview(idle/quiet/loading/live/error, eventId-keyed) + selectedEventIdRef(open/close에서 동기 갱신) + render guard; trigger는 detail loaded 후 non-empty location만 1회 POST, blank→quiet(no POST); retry는 클릭 시점 eventDetail.data.event.location 사용; close→idle.
- 적용 (4 null-coord guard): map query = (status==="resolved" && lat!=null && lng!=null) ? `${lat},${lng}` : data.locationText; displayLabel ?? locationText; providerStatus/providerResultId는 링크·UI에 노출 안 함. external URL = https://www.google.com/maps/search/?api=1&query=<encodeURIComponent> target=_blank rel=noopener noreferrer (키/raw 없음).
- 무시: 없음.
