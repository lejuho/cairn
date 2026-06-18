# Step 002 — Completion check: event detail sheet (server routes + frontend)

Cycle: 16
Pass: 2
Files Changed:
- shared/src/eventDetail.ts
- shared/src/index.ts
- server/src/repositories/annotations.ts
- server/src/routes/events.ts
- server/src/routes/events.integration.test.ts
- web/src/Today.tsx
- web/src/Today.test.tsx
- web/src/styles.css

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
- Concern 1 (sheet closes before refetch): Confirmed by design and correct. `handlePatchStatus` awaits patchStatus, closes the sheet, then awaits refresh(). UX is fine — error path keeps sheet open (catch noop).
- Concern 2 (close-btn scrolls away): Real bug. `.sheet-close-btn` is `position: absolute` but `.sheet` is `position: fixed` + `overflow-y: auto` — so the button anchors to the scroll content, not the viewport, and scrolls out of view on long content. Fix: make it `position: sticky`/`fixed` or move it into a non-scrolling header. Minor; only bites on overflowing detail content.
- Concern 3 (findEventWithPeople signature): Confirmed exists at server/src/repositories/people.ts:29. Returns EventPeopleResponse | null = `{ event, people: PersonRow[] }`. Used correctly.

## Sonnet Response
- 적용: Concern 2 — Fix `.sheet-close-btn` positioning. The button should be sticky so it stays visible when the sheet content scrolls. Switching to `position: sticky; top: 0` within a flex column layout.
- 무시: Concern 1 — UX is intentional; correct by design.
- 무시: Concern 3 — Confirmed correct; no action needed.
