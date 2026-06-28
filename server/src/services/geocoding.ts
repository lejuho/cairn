import type { EventGeocodeData, GeocodeCacheStatus, GeocodeConfidence, GeocodeStatus, GeocodeUncertainty, MapErrorCode, MapProvider } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { GeocodeOutcome, MapGateway } from "../maps/gateway.js";
import { findEventById } from "../repositories/events.js";
import { normalizeLocation } from "../maps/normalize.js";
import { findGeocodeByKey, upsertGeocode, type GeocodeCacheRow, type GeocodeCacheUpsert } from "../repositories/geocode-cache.js";

// Geocoding orchestration (cycle-73). Looks up the event, guards a blank
// location, serves the cache (no provider call on hit), otherwise calls the map
// gateway ONCE and persists exactly one provenance row. Provider failures map to
// scoped errors and never write a fabricated cache row; the event is untouched.

export type GeocodeServiceResult =
  | { ok: true; data: EventGeocodeData }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "location_missing" }
  | { ok: false; kind: "map_error"; code: MapErrorCode; message: string };

export async function geocodeEvent(db: CairnDatabase, mapGateway: MapGateway, eventId: number): Promise<GeocodeServiceResult> {
  const event = findEventById(db, eventId);
  if (!event) return { ok: false, kind: "not_found" };

  const locationText = event.location ?? "";
  if (locationText.trim().length === 0) return { ok: false, kind: "location_missing" };

  // Single normalization feeds both the cache lookup and the write.
  const provider = mapGateway.provider;
  const normalized = normalizeLocation(locationText);

  const cached = findGeocodeByKey(db, provider, normalized);
  if (cached) {
    return { ok: true, data: toData(cached, eventId, "hit") };
  }

  // `geocodeAddress` owns disabled/config-error mapping (cycle-73 review-v1
  // ISSUE-3): a disabled gateway returns `disabled` and a misconfigured one
  // returns `config_error` — both WITHOUT a provider HTTP call — so the route
  // keeps the actionable distinction instead of collapsing both to disabled.
  const result = await mapGateway.geocodeAddress(locationText);
  if (!result.ok) {
    // Transient/scoped/config failure — do not cache, do not fabricate coordinates.
    return { ok: false, kind: "map_error", code: result.error.code, message: result.error.message };
  }

  const row = upsertGeocode(db, outcomeToUpsert(result.outcome, provider, normalized, locationText));
  return { ok: true, data: toData(row, eventId, "miss") };
}

function outcomeToUpsert(outcome: GeocodeOutcome, provider: string, normalized: string, locationText: string): GeocodeCacheUpsert {
  const base = { provider, normalizedLocation: normalized, locationText, status: outcome.status, providerStatus: outcome.providerStatus };
  if (outcome.status === "resolved") {
    return {
      ...base,
      latitude: outcome.latitude,
      longitude: outcome.longitude,
      displayLabel: outcome.displayLabel,
      providerResultId: outcome.providerResultId,
      confidence: outcome.confidence,
      uncertaintyJson: JSON.stringify(outcome.uncertainty)
    };
  }
  if (outcome.status === "ambiguous") {
    return { ...base, latitude: null, longitude: null, displayLabel: null, providerResultId: null, confidence: "unknown", uncertaintyJson: JSON.stringify(outcome.uncertainty) };
  }
  // zero_results | failed — honest, no coordinate, no uncertainty payload.
  return { ...base, latitude: null, longitude: null, displayLabel: null, providerResultId: null, confidence: "unknown", uncertaintyJson: null };
}

function toData(row: GeocodeCacheRow, eventId: number, cacheStatus: GeocodeCacheStatus): EventGeocodeData {
  return {
    eventId,
    provider: row.provider as MapProvider,
    locationText: row.locationText,
    normalizedLocation: row.normalizedLocation,
    cacheStatus,
    status: row.status as GeocodeStatus,
    latitude: row.latitude,
    longitude: row.longitude,
    displayLabel: row.displayLabel,
    providerResultId: row.providerResultId,
    confidence: row.confidence as GeocodeConfidence,
    providerStatus: row.providerStatus,
    uncertainty: row.uncertaintyJson ? (JSON.parse(row.uncertaintyJson) as GeocodeUncertainty) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastCheckedAt: row.lastCheckedAt
  };
}
