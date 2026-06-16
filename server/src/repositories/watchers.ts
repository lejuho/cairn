import { eq } from "drizzle-orm";
import type { CreateWatcherRequest, WatcherRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { watchers } from "../db/schema.js";

export function createWatcher(
  db: CairnDatabase,
  input: CreateWatcherRequest
): WatcherRow {
  const rule = JSON.stringify({ type: "date_threshold", fireOn: input.threshold });
  const [row] = db
    .insert(watchers)
    .values({
      label: input.label,
      threshold: input.threshold,
      category: input.category ?? null,
      kind: "A",
      armed: 1,
      rule
    })
    .returning()
    .all();
  return row as WatcherRow;
}

export function snoozeWatcher(
  db: CairnDatabase,
  id: number,
  snoozedUntil: string
): WatcherRow | null {
  const [row] = db
    .update(watchers)
    .set({ snoozedUntil })
    .where(eq(watchers.id, id))
    .returning()
    .all();
  return (row as WatcherRow) ?? null;
}

export function findFiredWatchers(
  db: CairnDatabase,
  date: string,
  now: string
): WatcherRow[] {
  return db
    .select()
    .from(watchers)
    .all()
    .filter(
      (w) =>
        w.armed === 1 &&
        w.kind === "A" &&
        w.threshold != null &&
        w.threshold <= date &&
        (w.snoozedUntil == null || w.snoozedUntil <= now)
    ) as WatcherRow[];
}
