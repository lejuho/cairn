---
step: "001"
kind: "approach"
topic: "Today daily timeline — dayEvents field + timeline UI"
---

1. dayEvents in schema: APPLY — additive field, audit existing integration test fixtures for toEqual assertions.
2. Sorting: APPLY — ORDER BY start ASC in repository query (Drizzle), not service.
3. Active event: APPLY — Date.parse() epoch comparison, not lexicographic (UTC nowIso vs RFC3339 offset start).

No items ignored.
