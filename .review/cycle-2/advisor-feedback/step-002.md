---
step: "002"
type: "Completion check + Approach check"
topic: "Backend Repositories + TodayService approach"
---

## Completion Check — Step 002 Backend Repositories

### Query

1. findPlannedAndConfirmedByDate — DB 전체 rows 로드 후 in-memory filter. Cycle 2 scope에서 허용 가능한가?
2. EventRowSchema.start/end = datetime({offset:true}).nullable() — offset 없는 rows 파싱 실패 우려?

### Advisor Verdict

PASS (no blocking issues)

1. In-memory filter: ACCEPTABLE for Cycle 2 (Pi-local + small data). Add comment marking it as scope-bound shortcut so next cycle Codex doesn't re-flag.
2. datetime parse: REAL but DEFER. createEvent stores input.start which already passed CreateEventRequestSchema(offset:true). gcal-import path doesn't exist yet. Note for gcal-sync cycle: normalize-to-offset at write time.

### Applied

- Added comment to findPlannedAndConfirmedByDate and related query functions
- gcal datetime normalization deferred to gcal-sync cycle

---

## Approach Check — Step 003 TodayService

### Query

1. Service 구조 — Repository 직접 호출 vs 순수 aggregation (repos를 route에서 호출 후 data 주입)
2. conflict detection — O(n²) loop vs DB SQL self-join

### Advisor Response

1. Pure aggregation function. Route calls repos → passes events/tasks/watchers + now into `buildTodaySurface()`. Service: derive state/nextEvent/conflicts/twoMinuteTasks/cards only. No DB inside.
2. O(n²) pair loop. Small N — SQL self-join is over-engineering. Overlap test: a.start < b.end && b.start < a.end, skip null start/end, emit each pair once (i<j).
3. cards: conflict → watcher → next_event → two_minute_task order.
4. Validate output with TodaySurfaceSchema.parse at route boundary.

### Decision

APPLY all. buildTodaySurface() is pure aggregation, no DB access.
