import type { EventRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { findNeedsReviewEvents } from "../repositories/events.js";

export const NEEDS_REVIEW_WINDOW_MS = 36 * 60 * 60 * 1000;

export function listNeedsReviewEvents(
  db: CairnDatabase,
  nowIso: string,
  limit = 3
): EventRow[] {
  const windowStartIso = new Date(new Date(nowIso).getTime() - NEEDS_REVIEW_WINDOW_MS).toISOString();
  return findNeedsReviewEvents(db, nowIso, windowStartIso, limit);
}
