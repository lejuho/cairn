import type { ConflictPair, EventRow, TaskRow, TodaySurface, WatcherRow } from "@cairn/shared";

export function buildTodaySurface(
  date: string,
  now: string,
  dayEvents: EventRow[],
  twoMinuteTasks: TaskRow[],
  watcherBubbles: WatcherRow[]
): TodaySurface {
  const nextEvent = findNextEvent(dayEvents, now);
  const conflicts = findConflicts(dayEvents);

  const cards: TodaySurface["cards"] = [
    ...conflicts.map((pair) => ({ kind: "conflict" as const, pair })),
    ...watcherBubbles.map((watcher) => ({ kind: "watcher" as const, watcher })),
    ...(nextEvent ? [{ kind: "next_event" as const, event: nextEvent }] : []),
    ...twoMinuteTasks.map((task) => ({ kind: "two_minute_task" as const, task }))
  ];

  const state =
    cards.length === 0 && nextEvent === null ? "quiet" : "live";

  return { date, now, state, nextEvent, conflicts, twoMinuteTasks, watcherBubbles, cards };
}

function findNextEvent(events: EventRow[], now: string): EventRow | null {
  const upcoming = events.filter((e) => e.start != null && e.start >= now);
  if (upcoming.length === 0) return null;
  return upcoming.reduce<EventRow>((earliest, e) =>
    e.start! < earliest.start! ? e : earliest
  , upcoming[0]!);
}

function findConflicts(events: EventRow[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]!;
      const b = events[j]!;
      if (a.start == null || a.end == null || b.start == null || b.end == null) continue;
      if (a.start < b.end && b.start < a.end) {
        pairs.push({ a, b });
      }
    }
  }
  return pairs;
}
