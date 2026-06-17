---
step: "004"
kind: "approach"
topic: "ISSUE-1 fix: listThreads sort asc→desc"
---

1. desc(createdAt) safe: SQLite datetime('now') is fixed-width YYYY-MM-DD HH:MM:SS UTC text — lexicographic desc == chronological desc.
2. Add desc(id) tie-breaker: same-second inserts share createdAt text; id autoincrement breaks ties. Drizzle orderBy accepts multiple args. Keep asc import (used in findTasksByThreadId/findEventsByThreadId).
3. Integration test: insert two threads, assert summaries[0].thread.name === second inserted thread name. id tie-breaker guarantees order even at same timestamp.

All APPLY. No items ignored.
