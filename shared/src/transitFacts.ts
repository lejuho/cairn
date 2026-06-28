import { z } from "zod";

// Pinned transit facts (cycle-78). A user-authored, manual public-transit
// duration for a recurring adjacent location pair. Provider-neutral, directional
// (A→B is distinct from B→A), and always provenance-labeled (source=pinned_user)
// so it never masquerades as live provider data. No Naver/route payload is ever
// carried here.

export const PINNED_TRANSIT_MODES = ["public_transit"] as const;
export const PinnedTransitModeSchema = z.enum(PINNED_TRANSIT_MODES);

export const PINNED_TRANSIT_SOURCES = ["pinned_user"] as const;
export const PinnedTransitSourceSchema = z.enum(PINNED_TRANSIT_SOURCES);

export const PinnedTransitFactSchema = z
  .object({
    id: z.number().int().positive(),
    originNormalized: z.string(),
    destNormalized: z.string(),
    originLabel: z.string().nullable(),
    destLabel: z.string().nullable(),
    originLat: z.number(),
    originLng: z.number(),
    destLat: z.number(),
    destLng: z.number(),
    mode: PinnedTransitModeSchema,
    durationMinutes: z.number().int().positive(),
    note: z.string().nullable(),
    source: PinnedTransitSourceSchema,
    active: z.boolean(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    lastConfirmedAt: z.string().nullable()
  })
  .strict();

// Request takes ONLY event ids + duration/note — the server derives the location
// pair identity and coordinates from existing DB event/geocode rows. `.strict`
// rejects any attempt to submit coordinates or provenance from the browser.
export const UpsertPinnedTransitRequestSchema = z
  .object({
    fromEventId: z.number().int().positive(),
    toEventId: z.number().int().positive(),
    durationMinutes: z.number().int().min(1).max(600),
    note: z.string().max(200).optional()
  })
  .strict();

export const PINNED_TRANSIT_ERROR_CODES = ["VALIDATION_ERROR", "NOT_FOUND", "LOCATION_MISSING", "LOCATION_UNRESOLVED", "DB_ERROR"] as const;
export const PinnedTransitErrorCodeSchema = z.enum(PINNED_TRANSIT_ERROR_CODES);

export const PinnedTransitResponseSchema = z.union([
  z.object({ ok: z.literal(true), data: PinnedTransitFactSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: PinnedTransitErrorCodeSchema, message: z.string() }).strict() }).strict()
]);

export type PinnedTransitMode = z.infer<typeof PinnedTransitModeSchema>;
export type PinnedTransitSource = z.infer<typeof PinnedTransitSourceSchema>;
export type PinnedTransitFact = z.infer<typeof PinnedTransitFactSchema>;
export type UpsertPinnedTransitRequest = z.infer<typeof UpsertPinnedTransitRequestSchema>;
export type PinnedTransitErrorCode = z.infer<typeof PinnedTransitErrorCodeSchema>;
export type PinnedTransitResponse = z.infer<typeof PinnedTransitResponseSchema>;
