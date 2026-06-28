import { and, eq, inArray, sql } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { geocodeCache } from "../db/schema.js";

// Geocode cache repository (cycle-73). Pure persistence — NO provider calls here.
// Keyed by the unique (provider, normalized_location); writes are idempotent.

export type GeocodeCacheRow = {
  id: number;
  provider: string;
  normalizedLocation: string;
  locationText: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  displayLabel: string | null;
  providerResultId: string | null;
  confidence: string;
  providerStatus: string | null;
  uncertaintyJson: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastCheckedAt: string | null;
};

export type GeocodeCacheUpsert = {
  provider: string;
  normalizedLocation: string;
  locationText: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  displayLabel: string | null;
  providerResultId: string | null;
  confidence: string;
  providerStatus: string | null;
  uncertaintyJson: string | null;
};

// Cache-only batch read (cycle-75 Today location context). Loads every cache row
// across providers for the given normalized location keys. Read-only — NO
// provider call, NO write. Empty input → no query.
export function findGeocodeByNormalizedSet(db: CairnDatabase, normalizedLocations: string[]): GeocodeCacheRow[] {
  if (normalizedLocations.length === 0) return [];
  const rows = db
    .select()
    .from(geocodeCache)
    .where(inArray(geocodeCache.normalizedLocation, normalizedLocations))
    .all();
  return rows as GeocodeCacheRow[];
}

export function findGeocodeByKey(db: CairnDatabase, provider: string, normalizedLocation: string): GeocodeCacheRow | null {
  const row = db
    .select()
    .from(geocodeCache)
    .where(and(eq(geocodeCache.provider, provider), eq(geocodeCache.normalizedLocation, normalizedLocation)))
    .get();
  return row ? (row as GeocodeCacheRow) : null;
}

// Insert-or-update on the unique (provider, normalized_location). On a repeat
// call the same row is reused (no duplicate); only the provider facts +
// updated_at/last_checked_at are refreshed.
export function upsertGeocode(db: CairnDatabase, input: GeocodeCacheUpsert): GeocodeCacheRow {
  const [row] = db
    .insert(geocodeCache)
    .values({ ...input, lastCheckedAt: sql`(datetime('now'))` })
    .onConflictDoUpdate({
      target: [geocodeCache.provider, geocodeCache.normalizedLocation],
      set: {
        locationText: input.locationText,
        status: input.status,
        latitude: input.latitude,
        longitude: input.longitude,
        displayLabel: input.displayLabel,
        providerResultId: input.providerResultId,
        confidence: input.confidence,
        providerStatus: input.providerStatus,
        uncertaintyJson: input.uncertaintyJson,
        updatedAt: sql`(datetime('now'))`,
        lastCheckedAt: sql`(datetime('now'))`
      }
    })
    .returning()
    .all();
  return row as GeocodeCacheRow;
}
