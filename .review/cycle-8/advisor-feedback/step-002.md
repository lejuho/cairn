---
step: "002"
kind: "completion"
topic: "Today daily timeline"
files_changed:
  - shared/src/today.ts
  - server/src/repositories/events.ts
  - server/src/services/today.ts
  - web/src/Today.tsx
  - web/src/styles.css
  - web/src/Today.test.tsx
  - server/src/routes/today.integration.test.ts
---

1. Quiet logic change: new (cards===0 && dayEvents===0) is correct — all-ended events still render timeline → live. Integration test "returns live state when dayEvents exist even if all events ended" confirms this.
2. SQL orderBy + JS filter: filter preserves array order. Safe.
3. slice(11,16) shows UTC time — pre-existing pattern across all cards. Cycle 8 acceptable. Flag as local-time debt for future cycle.

No blockers. 85 integration + 29 web tests pass.
