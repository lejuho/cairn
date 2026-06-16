import { eq } from "drizzle-orm";
import type { CreateEventRequest, EventRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { events } from "../db/schema.js";

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

// scope-bound: full table scan + in-memory filter. Acceptable for Pi-local small dataset (Cycle 2).
export function findPlannedAndConfirmedByDate(
  db: CairnDatabase,
  date: string
): EventRow[] {
  return db
    .select()
    .from(events)
    .all()
    .filter(
      (e) =>
        e.start != null &&
        e.start.startsWith(date) &&
        (e.status === "planned" || e.status === "confirmed")
    ) as EventRow[];
}
