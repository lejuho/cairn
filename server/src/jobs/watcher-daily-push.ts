import type { CairnDatabase } from "../db/index.js";
import { findWatchersForPush, markWatchersFired } from "../repositories/watchers.js";
import { selectDueForPush } from "../services/watcher-daily-push.js";

export type WatcherPushSender = (message: string) => Promise<void>;

export type WatcherDailyPushJobResult = {
  sentCount: number;
  skippedCount: number;
  error?: string;
};

export async function runWatcherDailyPush(
  db: CairnDatabase,
  sender: WatcherPushSender,
  opts?: {
    date?: string; // YYYY-MM-DD, defaults to local today
    now?: string;  // ISO8601, defaults to new Date().toISOString()
  }
): Promise<WatcherDailyPushJobResult> {
  const now = opts?.now ?? new Date().toISOString();
  const date = opts?.date ?? localDateString();

  const rows = findWatchersForPush(db);
  const { items, message } = selectDueForPush(rows, date, now);

  const skippedCount = rows.length - items.length;

  if (items.length === 0) {
    return { sentCount: 0, skippedCount };
  }

  try {
    await sender(message);
  } catch (e) {
    return {
      sentCount: 0,
      skippedCount,
      error: e instanceof Error ? e.message : String(e)
    };
  }

  // Store local date (YYYY-MM-DD) so lastFired.slice(0,10) === date comparison
  // remains correct regardless of UTC offset at send time.
  try {
    markWatchersFired(db, items.map((i) => i.id), date);
  } catch (e) {
    // Message already delivered — log failure so retry can be evaluated.
    console.error("[watcher-push] markWatchersFired failed after successful send:", e);
  }

  return { sentCount: items.length, skippedCount };
}

function localDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
