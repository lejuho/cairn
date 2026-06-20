# Step 001 — Approach check: notification draft service architecture

Cycle: 24
Pass: 2
Files Changed: (none yet — pre-implementation approach check)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1) Call AFTER commit. Resolution is already atomic; draft generation is read-only with no writes, so it must not extend the transaction's lock window or risk aborting a committed resolution on a template error. Plan text contradicts the safer design — flag as DEFER/REJECT divergence in Communication Bridge.
2) New `findEventPeopleFullProfiles(db, eventId)` in people.ts, reusing PERSON_COLS + mapPersonRow. Matches existing repository conventions (findEventWithPeople pattern); keeps SQL out of the service.
3) New `shared/src/notification-drafts.ts`. decision.ts is conflict-domain; keep notification schemas cohesive. Re-export extended `ResolveConflictResponseDataSchema` by composing `NotificationDraftSchema` into it where it lives (decision.ts imports the draft schema).

## Sonnet Response
- 적용 (1): Draft generation will run AFTER the transaction commits, not inside it. Read-only template construction must not extend the lock window or let a template error roll back a committed resolution. Plan text ("inside ... before commit") diverges from the safer design; this will be surfaced explicitly in the Communication Bridge / RESOLVED notes so the divergence is auditable rather than a silent deviation.
- 적용 (2): Add `findEventPeopleFullProfiles(db, eventId)` as a new repository function in server/src/repositories/people.ts, reusing PERSON_COLS + mapPersonRow. Keeps SQL out of the service and matches existing repo conventions.
- 적용 (3): Put `NotificationDraftSchema` in new shared/src/notification-drafts.ts (notification-domain cohesion); decision.ts imports it to compose the extended `ResolveConflictResponseDataSchema`.
- 무시: none.
