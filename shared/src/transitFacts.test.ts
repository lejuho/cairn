import { describe, expect, it } from "vitest";
import {
  PinnedTransitFactSchema,
  PinnedTransitResponseSchema,
  UpsertPinnedTransitRequestSchema
} from "./transitFacts.js";

const FACT = {
  id: 1, originNormalized: "home", destNormalized: "station", originLabel: "집", destLabel: "역",
  originLat: 37.5, originLng: 127.0, destLat: 37.51, destLng: 127.02, mode: "public_transit",
  durationMinutes: 12, note: "9호선", source: "pinned_user", active: true,
  createdAt: "2026-06-28T00:00:00", updatedAt: null, lastConfirmedAt: "2026-06-28T00:00:00"
};

describe("Pinned transit fact schemas (cycle-78)", () => {
  it("accepts a valid pinned fact", () => {
    expect(PinnedTransitFactSchema.safeParse(FACT).success).toBe(true);
  });

  it("rejects a non-user source / non-transit mode / injected route fields (strict)", () => {
    expect(PinnedTransitFactSchema.safeParse({ ...FACT, source: "provider" }).success).toBe(false);
    expect(PinnedTransitFactSchema.safeParse({ ...FACT, mode: "drive" }).success).toBe(false);
    expect(PinnedTransitFactSchema.safeParse({ ...FACT, fare: 1250 }).success).toBe(false);
    expect(PinnedTransitFactSchema.safeParse({ ...FACT, subwayLine: "9호선" }).success).toBe(false);
  });

  it("upsert request accepts event ids + duration + optional note", () => {
    expect(UpsertPinnedTransitRequestSchema.safeParse({ fromEventId: 1, toEventId: 2, durationMinutes: 12 }).success).toBe(true);
    expect(UpsertPinnedTransitRequestSchema.safeParse({ fromEventId: 1, toEventId: 2, durationMinutes: 12, note: "메모" }).success).toBe(true);
  });

  it("upsert request REJECTS browser-supplied coordinates and out-of-range duration (strict)", () => {
    expect(UpsertPinnedTransitRequestSchema.safeParse({ fromEventId: 1, toEventId: 2, durationMinutes: 12, fromLat: 37.5 }).success).toBe(false);
    expect(UpsertPinnedTransitRequestSchema.safeParse({ fromEventId: 1, toEventId: 2, durationMinutes: 12, originLat: 37.5, originLng: 127 }).success).toBe(false);
    expect(UpsertPinnedTransitRequestSchema.safeParse({ fromEventId: 1, toEventId: 2, durationMinutes: 0 }).success).toBe(false);
    expect(UpsertPinnedTransitRequestSchema.safeParse({ fromEventId: 1, toEventId: 2, durationMinutes: 601 }).success).toBe(false);
    expect(UpsertPinnedTransitRequestSchema.safeParse({ fromEventId: 1, toEventId: 2, durationMinutes: 12, note: "x".repeat(201) }).success).toBe(false);
    expect(UpsertPinnedTransitRequestSchema.safeParse({ fromEventId: 1.5, toEventId: 2, durationMinutes: 12 }).success).toBe(false);
  });

  it("response union accepts success + typed error and rejects an injected field", () => {
    expect(PinnedTransitResponseSchema.safeParse({ ok: true, data: FACT }).success).toBe(true);
    expect(PinnedTransitResponseSchema.safeParse({ ok: false, error: { code: "LOCATION_UNRESOLVED", message: "x" } }).success).toBe(true);
    expect(PinnedTransitResponseSchema.safeParse({ ok: false, error: { code: "WHATEVER", message: "x" } }).success).toBe(false);
    expect(PinnedTransitResponseSchema.safeParse({ ok: true, data: FACT, extra: 1 }).success).toBe(false);
  });
});
