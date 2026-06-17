import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { CreateEventRequest, EventRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { annotations, events } from "../db/schema.js";

export function createEvent(db: CairnDatabase, input: CreateEventRequest): EventRow {
  const [row] = db
    .insert(events)
    .values({
      title: input.title,
      start: input.start,
      end: input.end,
      type: input.type ?? null,
      location: input.location ?? null,
      threadId: input.threadId ?? null,
      source: "cairn",
      selfImposed: 1,
      status: "planned"
    })
    .returning()
    .all();
  return row as EventRow;
}

export function findEventsByDate(
  db: CairnDatabase,
  date: string
): EventRow[] {
  return db
    .select()
    .from(events)
    .where(eq(events.status, "planned"))
    .all()
    .filter((e) => e.start != null && e.start.startsWith(date)) as EventRow[];
}

export function findNeedsReviewEvents(
  db: CairnDatabase,
  nowIso: string,
  windowStartIso: string,
  limit = 3
): EventRow[] {
  const rows = db
    .select({ event: events })
    .from(events)
    .leftJoin(annotations, eq(annotations.eventId, events.id))
    .where(
      and(
        or(eq(events.status, "planned"), eq(events.status, "confirmed")),
        isNotNull(events.end),
        isNull(annotations.id)
      )
    )
    .all();

  const nowMs = new Date(nowIso).getTime();
  const windowMs = new Date(windowStartIso).getTime();

  return rows
    .map((r) => r.event as EventRow)
    .filter((e) => {
      const endMs = new Date(e.end!).getTime();
      return endMs <= nowMs && endMs >= windowMs;
    })
    .sort((a, b) => new Date(b.end!).getTime() - new Date(a.end!).getTime())
    .slice(0, limit);
}

// scope-bound: full table scan + in-memory filter. Acceptable for Pi-local small dataset (Cycle 2).
export function findEventById(db: CairnDatabase, id: number): EventRow | null {
  const row = db.select().from(events).where(eq(events.id, id)).get();
  return row ? (row as EventRow) : null;
}

export function updateEventStatus(db: CairnDatabase, eventId: number, status: string): void {
  db.update(events).set({ status }).where(eq(events.id, eventId)).run();
}

export function findPlannedAndConfirmedByDate(
  db: CairnDatabase,
  date: string
): EventRow[] {
  return db
    .select()
    .from(events)
    .orderBy(asc(events.start))
    .all()
    .filter(
      (e) =>
        e.start != null &&
        e.start.startsWith(date) &&
        (e.status === "planned" || e.status === "confirmed")
    ) as EventRow[];
}
