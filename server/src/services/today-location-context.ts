import type { EventRow, GeocodeConfidence, GeocodeUncertainty, TodayEventLocationContext } from "@cairn/shared";
import { GeocodeUncertaintySchema } from "@cairn/shared";
import { normalizeLocation } from "../maps/normalize.js";
import type { GeocodeCacheRow } from "../repositories/geocode-cache.js";

// Pure, deterministic Today location context shaping (cycle-75). Maps event rows
// + already-read geocode_cache rows into provider-neutral context. NO provider
// call, NO DB access, NO write — the route reads the cache and passes rows here.
//
// status: blank/null location → `missing`; non-empty with no cache row →
// `uncached`; otherwise the cached `resolved|ambiguous|zero_results|failed`.
export function buildTodayLocationContexts(events: EventRow[], cacheRows: GeocodeCacheRow[]): TodayEventLocationContext[] {
  // Group cache rows by normalized location with a deterministic provider pick
  // (provider asc, first). The (provider, normalized_location) unique index means
  // at most one row per provider; this only matters if a future provider adds a
  // second row for the same location.
  const byNormalized = new Map<string, GeocodeCacheRow>();
  for (const row of [...cacheRows].sort(byProviderAsc)) {
    if (!byNormalized.has(row.normalizedLocation)) byNormalized.set(row.normalizedLocation, row);
  }

  const seen = new Set<number>();
  const contexts: TodayEventLocationContext[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    const location = event.location ?? "";
    if (location.trim().length === 0) {
      contexts.push(emptyContext(event.id, event.location ?? null, "missing"));
      continue;
    }
    const row = byNormalized.get(normalizeLocation(location));
    contexts.push(row ? rowContext(event.id, location, row) : emptyContext(event.id, location, "uncached"));
  }
  return contexts;
}

function byProviderAsc(a: GeocodeCacheRow, b: GeocodeCacheRow): number {
  return a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0;
}

function emptyContext(eventId: number, locationText: string | null, status: "missing" | "uncached"): TodayEventLocationContext {
  return {
    eventId, locationText, status,
    provider: null, displayLabel: null, latitude: null, longitude: null,
    confidence: null, providerStatus: null, uncertainty: null, updatedAt: null, lastCheckedAt: null
  };
}

function rowContext(eventId: number, locationText: string, row: GeocodeCacheRow): TodayEventLocationContext {
  return {
    eventId,
    locationText,
    status: row.status as TodayEventLocationContext["status"],
    provider: row.provider,
    displayLabel: row.displayLabel,
    latitude: row.latitude,
    longitude: row.longitude,
    confidence: row.confidence as GeocodeConfidence,
    providerStatus: row.providerStatus,
    uncertainty: parseUncertainty(row.uncertaintyJson),
    updatedAt: row.updatedAt,
    lastCheckedAt: row.lastCheckedAt
  };
}

// Fail open: missing or malformed uncertainty JSON yields null so Today still loads.
function parseUncertainty(json: string | null): GeocodeUncertainty | null {
  if (!json) return null;
  try {
    const parsed = GeocodeUncertaintySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
