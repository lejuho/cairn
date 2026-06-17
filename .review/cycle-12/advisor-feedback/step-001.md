# Step 001 — flat one-line capture (Approach check)

Cycle: 12
Pass: 2
Files Changed: (none yet — approach check before implementation)
Planned: shared/src/capture.ts, server/src/repositories/events.ts, server/src/llm/flatEventParser.ts, server/src/services/flatCapture.ts, server/src/routes/capture.ts, server/src/app.ts, web/src/Today.tsx

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
Steps:
1. insertRawEvent separate fn — Correct. createEvent requires start+end via schema; raw rows need null start/end. Separate fn keeps schema invariant intact.
2. start+60min via Date arithmetic — Risky. `new Date(rfc3339).toISOString()` drops original offset, returns Z. Spec wants offset-preserving. Add 60min to epoch, re-emit with same offset string, or store as-is + compute end in same zone. Verify end column format matches createEvent's.
3. Gateway-gated route — Acceptable. Matches annotation precedent; null→404 consistent.
4. savedMessage — Auto-clear 4s, but clear on next submit too.

Regression risks:
- end offset corruption (point 2).
- insertRawEvent must set status/source/selfImposed identically or Today filters break.
- min(1) after trim — guard whitespace-only text.

## Sonnet Response
- 적용 (point 1): insertRawEvent as a separate repository fn. Keeps CreateEventRequestSchema invariant (start+end required) untouched.
- 적용 (point 2): Do NOT use `new Date(start).toISOString()` for end — it collapses the offset to Z. Instead add 60min to the epoch then re-emit preserving the original offset string. Will verify computed end format matches what createEvent persists.
- 적용 (point 3): Gateway-gated route registration confirmed acceptable; mirrors annotation route precedent (null gateway → 404; gateway returning {ok:false} → service raw-stores).
- 적용 (point 4): savedMessage auto-clears after 4s AND clears on next submit.
- 적용 (regression — Today filters): insertRawEvent sets source='cairn', selfImposed=1, status='planned' identically to createEvent so Today's filters do not drop raw rows.
- 적용 (regression — whitespace): trim input before the min(1) check / before raw-store fallback so whitespace-only text is rejected, not stored as a blank-title raw event.
- 무시: none.
