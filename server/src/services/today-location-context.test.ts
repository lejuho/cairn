import { describe, expect, it } from "vitest";
import type { EventRow } from "@cairn/shared";
import { buildTodayLocationContexts } from "./today-location-context.js";
import type { GeocodeCacheRow } from "../repositories/geocode-cache.js";

function ev(id: number, location: string | null): EventRow {
  return {
    id, threadId: null, title: `e${id}`, type: null, start: null, end: null,
    location, mode: null, source: "cairn", selfImposed: 1, status: "planned", createdAt: null, updatedAt: null
  };
}
function row(over: Partial<GeocodeCacheRow> & { normalizedLocation: string }): GeocodeCacheRow {
  return {
    id: 1, provider: "google", locationText: over.normalizedLocation, status: "resolved",
    latitude: 37.55, longitude: 126.98, displayLabel: "N Seoul Tower", providerResultId: "p1",
    confidence: "high", providerStatus: "OK", uncertaintyJson: JSON.stringify({ locationType: "ROOFTOP", partialMatch: false }),
    createdAt: "t", updatedAt: null, lastCheckedAt: "t", ...over
  };
}

describe("buildTodayLocationContexts (cycle-75)", () => {
  it("blank/null location → missing; non-empty uncached → uncached", () => {
    const ctx = buildTodayLocationContexts([ev(1, null), ev(2, "   "), ev(3, "어딘가")], []);
    expect(ctx.find((c) => c.eventId === 1)?.status).toBe("missing");
    expect(ctx.find((c) => c.eventId === 2)?.status).toBe("missing");
    const c3 = ctx.find((c) => c.eventId === 3);
    expect(c3?.status).toBe("uncached");
    expect(c3?.locationText).toBe("어딘가");
    expect(c3?.latitude).toBeNull();
  });

  it("cached resolved row → coordinate-backed context keyed by normalized location", () => {
    // "  Seoul  Tower " normalizes to the cache key "seoul tower".
    const ctx = buildTodayLocationContexts([ev(7, "  Seoul  Tower ")], [row({ normalizedLocation: "seoul tower" })]);
    const c = ctx[0]!;
    expect(c).toMatchObject({ status: "resolved", latitude: 37.55, longitude: 126.98, displayLabel: "N Seoul Tower", confidence: "high", provider: "google" });
    expect(c.locationText).toBe("  Seoul  Tower "); // authored text preserved, not the normalized key
    expect(c.uncertainty).toEqual({ locationType: "ROOFTOP", partialMatch: false });
  });

  it("ambiguous/zero_results/failed preserve status without fabricated coordinates", () => {
    const amb = row({ normalizedLocation: "tower", status: "ambiguous", latitude: null, longitude: null, displayLabel: null, confidence: "unknown", uncertaintyJson: JSON.stringify({ resultCount: 2, candidateLabels: ["A", "B"] }) });
    const zero = row({ normalizedLocation: "nowhere", status: "zero_results", latitude: null, longitude: null, displayLabel: null, confidence: "unknown", uncertaintyJson: null });
    const ctx = buildTodayLocationContexts([ev(1, "Tower"), ev(2, "nowhere")], [amb, zero]);
    expect(ctx[0]).toMatchObject({ status: "ambiguous", latitude: null, longitude: null });
    expect(ctx[0]!.uncertainty).toEqual({ resultCount: 2, candidateLabels: ["A", "B"] });
    expect(ctx[1]).toMatchObject({ status: "zero_results", latitude: null, longitude: null, uncertainty: null });
  });

  it("malformed uncertainty JSON fails open to null (does not throw)", () => {
    const bad = row({ normalizedLocation: "x", uncertaintyJson: "{not json" });
    const worse = row({ normalizedLocation: "y", uncertaintyJson: JSON.stringify({ error_message: "leak" }) });
    const ctx = buildTodayLocationContexts([ev(1, "x"), ev(2, "y")], [bad, worse]);
    expect(ctx[0]!.uncertainty).toBeNull();
    expect(ctx[1]!.uncertainty).toBeNull(); // strict schema rejects the injected field → null
  });

  it("dedupes by event id (first wins) and shares one cache read across same-location events", () => {
    const ctx = buildTodayLocationContexts([ev(5, "Seoul Tower"), ev(6, "seoul tower"), ev(5, "Seoul Tower")], [row({ normalizedLocation: "seoul tower" })]);
    expect(ctx).toHaveLength(2);
    expect(ctx.map((c) => c.eventId)).toEqual([5, 6]);
    expect(ctx.every((c) => c.status === "resolved")).toBe(true);
  });

  it("picks a deterministic provider row when more than one exists for a normalized location", () => {
    const google = row({ id: 1, provider: "google", normalizedLocation: "seoul tower", displayLabel: "Google label" });
    const mapbox = row({ id: 2, provider: "mapbox", normalizedLocation: "seoul tower", displayLabel: "Mapbox label" });
    const a = buildTodayLocationContexts([ev(1, "Seoul Tower")], [google, mapbox])[0]!;
    const b = buildTodayLocationContexts([ev(1, "Seoul Tower")], [mapbox, google])[0]!;
    expect(a.provider).toBe("google"); // provider asc, stable regardless of input order
    expect(b.provider).toBe("google");
  });
});
