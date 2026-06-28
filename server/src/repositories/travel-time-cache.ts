import { and, eq, sql } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { travelTimeCache } from "../db/schema.js";

// Travel-time cache repository (cycle-76). Pure persistence — NO provider calls.
// Keyed by the unique (provider, mode, origin_normalized, dest_normalized);
// writes are idempotent.

export type TravelCacheRow = {
  id: number;
  provider: string;
  mode: string;
  originNormalized: string;
  destNormalized: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  durationSeconds: number | null;
  durationMinutes: number | null;
  distanceMeters: number | null;
  status: string;
  providerStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastCheckedAt: string | null;
};

export type TravelCacheUpsert = {
  provider: string;
  mode: string;
  originNormalized: string;
  destNormalized: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  durationSeconds: number | null;
  durationMinutes: number | null;
  distanceMeters: number | null;
  status: string;
  providerStatus: string | null;
};

export function findTravelByKey(
  db: CairnDatabase,
  provider: string,
  mode: string,
  originNormalized: string,
  destNormalized: string
): TravelCacheRow | null {
  const row = db
    .select()
    .from(travelTimeCache)
    .where(
      and(
        eq(travelTimeCache.provider, provider),
        eq(travelTimeCache.mode, mode),
        eq(travelTimeCache.originNormalized, originNormalized),
        eq(travelTimeCache.destNormalized, destNormalized)
      )
    )
    .get();
  return row ? (row as TravelCacheRow) : null;
}

// Insert-or-update on the unique pair key. A repeat call reuses the same row
// (no duplicate) and refreshes the facts + updated_at/last_checked_at.
export function upsertTravel(db: CairnDatabase, input: TravelCacheUpsert): TravelCacheRow {
  const [row] = db
    .insert(travelTimeCache)
    .values({ ...input, lastCheckedAt: sql`(datetime('now'))` })
    .onConflictDoUpdate({
      target: [travelTimeCache.provider, travelTimeCache.mode, travelTimeCache.originNormalized, travelTimeCache.destNormalized],
      set: {
        originLat: input.originLat,
        originLng: input.originLng,
        destLat: input.destLat,
        destLng: input.destLng,
        durationSeconds: input.durationSeconds,
        durationMinutes: input.durationMinutes,
        distanceMeters: input.distanceMeters,
        status: input.status,
        providerStatus: input.providerStatus,
        updatedAt: sql`(datetime('now'))`,
        lastCheckedAt: sql`(datetime('now'))`
      }
    })
    .returning()
    .all();
  return row as TravelCacheRow;
}
