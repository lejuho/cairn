import { eq, inArray } from "drizzle-orm";
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

// Returns armed kind-A rows for the pure evaluator. Date/snooze filtering
// is deferred to the service so rule parsing stays in one place.
export function findAllWatchersForEvaluation(db: CairnDatabase): WatcherRow[] {
  return db
    .select()
    .from(watchers)
    .all()
    .filter((w) => w.armed === 1 && w.kind === "A") as WatcherRow[];
}

// Returns all watcher rows, no filter, ordered by id asc. Deep-view service
// handles status derivation and sort.
export function findAllWatchers(db: CairnDatabase): WatcherRow[] {
  return db.select().from(watchers).orderBy(watchers.id).all() as WatcherRow[];
}

// Updates only the armed flag. Returns the updated row or null if not found.
export function setWatcherArmed(db: CairnDatabase, id: number, armed: boolean): WatcherRow | null {
  const [row] = db
    .update(watchers)
    .set({ armed: armed ? 1 : 0 })
    .where(eq(watchers.id, id))
    .returning()
    .all();
  return (row as WatcherRow) ?? null;
}

// Returns armed kind-A rows for the push job. Mirrors findAllWatchersForEvaluation
// but is a separate function so future changes to each filter stay independent.
export function findWatchersForPush(db: CairnDatabase): WatcherRow[] {
  return db
    .select()
    .from(watchers)
    .all()
    .filter((w) => w.armed === 1 && w.kind === "A") as WatcherRow[];
}

// Sets last_fired for a set of watcher ids. firedAt is the ISO8601 timestamp
// of the send instant. No-op when ids is empty.
export function markWatchersFired(
  db: CairnDatabase,
  ids: number[],
  firedAt: string
): void {
  if (ids.length === 0) return;
  db.update(watchers)
    .set({ lastFired: firedAt })
    .where(inArray(watchers.id, ids))
    .run();
}
