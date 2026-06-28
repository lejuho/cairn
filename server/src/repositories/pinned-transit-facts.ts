import { and, eq, sql } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { pinnedTransitFacts } from "../db/schema.js";

// Pinned transit facts repository (cycle-78). Pure persistence — NO provider
// calls. Keyed by the unique directional (origin_normalized, dest_normalized,
// mode); writes are idempotent and re-pinning refreshes last_confirmed_at.

export type PinnedTransitRow = {
  id: number;
  originNormalized: string;
  destNormalized: string;
  originLabel: string | null;
  destLabel: string | null;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  mode: string;
  durationMinutes: number;
  note: string | null;
  source: string;
  active: number;
  createdAt: string | null;
  updatedAt: string | null;
  lastConfirmedAt: string | null;
};

export type PinnedTransitUpsert = {
  originNormalized: string;
  destNormalized: string;
  originLabel: string | null;
  destLabel: string | null;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  mode: string;
  durationMinutes: number;
  note: string | null;
  source: string;
};

export function findPinnedByPair(db: CairnDatabase, originNormalized: string, destNormalized: string, mode: string): PinnedTransitRow | null {
  const row = db
    .select()
    .from(pinnedTransitFacts)
    .where(
      and(
        eq(pinnedTransitFacts.originNormalized, originNormalized),
        eq(pinnedTransitFacts.destNormalized, destNormalized),
        eq(pinnedTransitFacts.mode, mode)
      )
    )
    .get();
  return row ? (row as PinnedTransitRow) : null;
}

export function listActivePinned(db: CairnDatabase): PinnedTransitRow[] {
  return db.select().from(pinnedTransitFacts).where(eq(pinnedTransitFacts.active, 1)).all() as PinnedTransitRow[];
}

// Insert-or-update on the unique directional pair+mode. Re-pinning the same pair
// reuses the row (no duplicate), refreshes the user facts, marks it active, and
// bumps updated_at + last_confirmed_at.
export function upsertPinned(db: CairnDatabase, input: PinnedTransitUpsert): PinnedTransitRow {
  const [row] = db
    .insert(pinnedTransitFacts)
    .values({ ...input, active: 1, lastConfirmedAt: sql`(datetime('now'))` })
    .onConflictDoUpdate({
      target: [pinnedTransitFacts.originNormalized, pinnedTransitFacts.destNormalized, pinnedTransitFacts.mode],
      set: {
        originLabel: input.originLabel,
        destLabel: input.destLabel,
        originLat: input.originLat,
        originLng: input.originLng,
        destLat: input.destLat,
        destLng: input.destLng,
        durationMinutes: input.durationMinutes,
        note: input.note,
        source: input.source,
        active: 1,
        updatedAt: sql`(datetime('now'))`,
        lastConfirmedAt: sql`(datetime('now'))`
      }
    })
    .returning()
    .all();
  return row as PinnedTransitRow;
}
