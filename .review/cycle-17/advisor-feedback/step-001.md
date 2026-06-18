# Step 001 — Approach check: feasibility service + route + Today integration

Cycle: 17
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
- JP1: Compute in route, pass to buildTodaySurface. Keep feasibility a pure function. Route reads params via repo, calls service, injects result. Don't inject db into buildTodaySurface.
- JP2: "gap or next event within 6h of now" — interpret as next-event-start <= now+6h. Independent of gap size.
- JP3: Use Number(value) + Number.isFinite guard, fall back to default. Rejects partial-parse junk that parseFloat accepts.

## Sonnet Response
- 적용: JP1 — feasibility computed in route before buildTodaySurface call, passed as arg.
- 적용: JP2 — near mode: Date.parse(event[i+1].start) - Date.parse(now) <= 6*3600*1000.
- 적용: JP3 — Number(value) + Number.isFinite guard for params.
- 무시: none
