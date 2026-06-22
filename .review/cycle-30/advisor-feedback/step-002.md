# Step 002 — completion: Watcher A today loop (cycle 30)

Cycle: 30
Pass: 1
Files Changed:
- shared/src/watchers.ts
- shared/src/today.ts
- shared/src/watchers.test.ts (new)
- server/src/services/watchers.ts (new)
- server/src/services/watchers.test.ts (new)
- server/src/repositories/watchers.ts
- server/src/routes/today.ts
- server/src/services/today.ts
- server/src/routes/watcher-evaluation.integration.test.ts (new)
- web/src/Today.tsx
- web/src/Today.test.tsx
- docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
- Concern 1 (cross-contamination): clean. WatcherRow gone from today.ts and services/today.ts; both use WatcherABubble only. Create/snooze API responses still use WatcherRow independently — no overlap.
- Concern 2 (card priority): correct. Order in today.ts:19-26 unchanged: conflict → watcher → next_event.
- Concern 3 (callers updated): yes. Sole caller routes/today.ts passes watcherBubbles; param + return type consistently WatcherABubble.
- Concern 4 (findFiredWatchers): safe but dead. Zero callers — flagged for drop.

## Sonnet Response
- 적용: findFiredWatchers 제거 (caller 없음 확인). 모든 다른 항목 PASS.
- 무시: 없음.
