# Step 001 — approach: Watcher A evaluator + derived bubble (cycle 30)

Cycle: 30
Pass: 1
Files Changed: (pending — pre-implementation check)

## Advisor Verdict
PASS

## Advisor Feedback
1. Schema: .strict() to reject score/advice. reasonCodes enum only what is emitted this cycle: date_threshold_due. Do NOT add "overdue" (YAGNI; daysOverdue field carries that signal). Add codes only when a test surfaces them.
2. daysOverdue: UTC-diff Math.max(0, …), clamp. Two messages (=0 vs >0) fine. Keep copy in one place.
3. findAllWatchersForEvaluation: SQL-filter armed=1, kind='A'; evaluator handles rule/threshold/snooze. Read-only.
4. Snooze target: surface.now + 1 day in ISO. Not browser clock. Plan mandates.
5. On snooze success: re-run loadTodayData() — server is source of truth. No local-remove.

## Sonnet Response
- 적용 1: WatcherABubbleSchema .strict(), reasonCodes z.enum(["date_threshold_due"]) only.
- 적용 2: daysOverdue Math.max(0, UTC diff), two messages.
- 적용 3: findAllWatchersForEvaluation with armed=1 + kind="A" SQL filter.
- 적용 4: snooze target = Date.parse(surface.now) + 86_400_000.
- 적용 5: loadTodayData() 재호출 on snooze success.
- 무시: 없음.
