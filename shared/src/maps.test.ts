import { describe, expect, it } from "vitest";
import {
  EventGeocodeDataSchema,
  EventGeocodeResponseSchema,
  GeocodeUncertaintySchema,
  MapErrorCodeSchema
} from "./maps.js";

const RESOLVED = {
  eventId: 7,
  provider: "google",
  locationText: "Seoul Tower",
  normalizedLocation: "seoul tower",
  cacheStatus: "miss",
  status: "resolved",
  latitude: 37.55,
  longitude: 126.98,
  displayLabel: "N Seoul Tower, Seoul",
  providerResultId: "place_123",
  confidence: "high",
  providerStatus: "OK",
  uncertainty: { locationType: "ROOFTOP", partialMatch: false },
  createdAt: "2026-06-28T00:00:00",
  updatedAt: null,
  lastCheckedAt: "2026-06-28T00:00:00"
};

describe("Geocode schemas (cycle-73)", () => {
  it("MAP_ERROR_CODES includes the new 'disabled' scoped code", () => {
    expect(MapErrorCodeSchema.safeParse("disabled").success).toBe(true);
  });

  it("accepts a resolved geocode data row", () => {
    expect(EventGeocodeDataSchema.safeParse(RESOLVED).success).toBe(true);
  });

  it("accepts an ambiguous row with null coords + candidate labels", () => {
    const r = EventGeocodeDataSchema.safeParse({
      ...RESOLVED, status: "ambiguous", latitude: null, longitude: null, displayLabel: null, providerResultId: null, confidence: "unknown",
      uncertainty: { resultCount: 3, candidateLabels: ["A", "B", "C"] }
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid status / confidence / cacheStatus", () => {
    expect(EventGeocodeDataSchema.safeParse({ ...RESOLVED, status: "great" }).success).toBe(false);
    expect(EventGeocodeDataSchema.safeParse({ ...RESOLVED, confidence: "perfect" }).success).toBe(false);
    expect(EventGeocodeDataSchema.safeParse({ ...RESOLVED, cacheStatus: "stale" }).success).toBe(false);
  });

  it("uncertainty is strict — rejects injected raw provider fields", () => {
    expect(GeocodeUncertaintySchema.safeParse({ locationType: "ROOFTOP", address_components: [{}] }).success).toBe(false);
    expect(GeocodeUncertaintySchema.safeParse({ error_message: "bad key" }).success).toBe(false);
  });

  it("response union accepts success + error and rejects an injected field", () => {
    expect(EventGeocodeResponseSchema.safeParse({ ok: true, data: RESOLVED }).success).toBe(true);
    expect(EventGeocodeResponseSchema.safeParse({ ok: false, error: { code: "denied", message: "x" } }).success).toBe(true);
    expect(EventGeocodeResponseSchema.safeParse({ ok: true, data: RESOLVED, extra: 1 }).success).toBe(false);
  });
});
