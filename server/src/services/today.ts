import type { ConflictPair, DayFeasibility, EventRow, TaskRow, TodaySurface, WatcherABubble } from "@cairn/shared";
import { computeNeedsReviewPlacement } from "./needsReviewPlacement.js";

const SCHEDULE_PROMPT_LIMIT = 3;

export function buildTodaySurface(
  date: string,
  now: string,
  dayEvents: EventRow[],
  twoMinuteTasks: TaskRow[],
  watcherBubbles: WatcherABubble[],
  needsReviewEvents: EventRow[],
  unscheduledEvents: EventRow[],
  feasibility: DayFeasibility
): TodaySurface {
  const nextEvent = findNextEvent(dayEvents, now);
  const conflicts = findConflicts(dayEvents);
  const schedulePrompts = unscheduledEvents.slice(0, SCHEDULE_PROMPT_LIMIT);

  const cards: TodaySurface["cards"] = [
    ...conflicts.map((pair) => ({ kind: "conflict" as const, pair })),
    ...watcherBubbles.map((watcher) => ({ kind: "watcher" as const, watcher })),
    ...(nextEvent ? [{ kind: "next_event" as const, event: nextEvent }] : []),
    ...twoMinuteTasks.map((task) => ({ kind: "two_minute_task" as const, task })),
    ...needsReviewEvents.map((event) => ({
      kind: "needs_review" as const,
      event,
      placement: computeNeedsReviewPlacement(event, feasibility.transitionCosts, now)
    })),
    ...schedulePrompts.map((event) => ({ kind: "schedule_prompt" as const, event }))
  ];

  const state =
    cards.length === 0 && dayEvents.length === 0 ? "quiet" : "live";

  return { date, now, state, nextEvent, conflicts, twoMinuteTasks, watcherBubbles, needsReviewEvents, unscheduledEvents, dayEvents, cards, feasibility };
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
