import { z } from "zod";

// Map provider boundary (cycle-72). Provider-neutral diagnostic types only —
// no coordinates, no raw provider payloads, no API-key material crosses this
// contract. Provider-specific request/response shapes stay inside the server
// `maps/` gateway.

export const MAP_PROVIDERS = ["disabled", "google"] as const;
export const MapProviderSchema = z.enum(MAP_PROVIDERS);

// Stable diagnostic status. `disabled` = provider off; `ok`/`zero_results` are
// the only provider-neutral success statuses surfaced for a smoke geocode.
export const MAP_SMOKE_STATUSES = ["disabled", "ok", "zero_results"] as const;
export const MapSmokeStatusSchema = z.enum(MAP_SMOKE_STATUSES);

// Stable map gateway error codes. Provider statuses/HTTP codes are mapped onto
// these; raw provider error_message is never carried here.
export const MAP_ERROR_CODES = [
  "config_error",
  "disabled", // cycle-73: MAP_PROVIDER=disabled — a scoped, non-cached map error
  "rate_limited",
  "denied",
  "invalid_request",
  "invalid_response",
  "unavailable"
] as const;
export const MapErrorCodeSchema = z.enum(MAP_ERROR_CODES);

export const MapProviderSmokeDataSchema = z
  .object({
    provider: MapProviderSchema,
    configured: z.boolean(),
    attempted: z.boolean(),
    reachable: z.boolean(),
    status: MapSmokeStatusSchema,
    resultCount: z.number().int().min(0)
  })
  .strict();

export const MapProviderSmokeErrorSchema = z
  .object({
    code: MapErrorCodeSchema,
    message: z.string()
  })
  .strict();

export const MapProviderSmokeResponseSchema = z.union([
  z.object({ ok: z.literal(true), data: MapProviderSmokeDataSchema }).strict(),
  z.object({ ok: z.literal(false), error: MapProviderSmokeErrorSchema }).strict()
]);

// ── Geocoding cache (cycle-73) ───────────────────────────────────────────────
// Provider-neutral geocode facts. Cache rows persist provider-derived facts for
// a normalized location; `cacheStatus` (hit|miss) is a RESPONSE-only envelope
// value, never stored on the row.

export const GEOCODE_STATUSES = ["resolved", "ambiguous", "zero_results", "failed"] as const;
export const GeocodeStatusSchema = z.enum(GEOCODE_STATUSES);

export const GEOCODE_CONFIDENCES = ["high", "medium", "low", "unknown"] as const;
export const GeocodeConfidenceSchema = z.enum(GEOCODE_CONFIDENCES);

export const GEOCODE_CACHE_STATUSES = ["hit", "miss"] as const;
export const GeocodeCacheStatusSchema = z.enum(GEOCODE_CACHE_STATUSES);

// Provider-neutral uncertainty — typed (no raw provider payload). resolved uses
// locationType/partialMatch; ambiguous uses resultCount/candidateLabels.
export const GeocodeUncertaintySchema = z
  .object({
    locationType: z.string().nullable().optional(),
    partialMatch: z.boolean().optional(),
    resultCount: z.number().int().min(0).optional(),
    candidateLabels: z.array(z.string()).optional()
  })
  .strict();

export const EventGeocodeDataSchema = z
  .object({
    eventId: z.number().int().positive(),
    provider: MapProviderSchema,
    locationText: z.string(),
    normalizedLocation: z.string(),
    cacheStatus: GeocodeCacheStatusSchema,
    status: GeocodeStatusSchema,
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    displayLabel: z.string().nullable(),
    providerResultId: z.string().nullable(),
    confidence: GeocodeConfidenceSchema,
    providerStatus: z.string().nullable(),
    uncertainty: GeocodeUncertaintySchema.nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    lastCheckedAt: z.string().nullable()
  })
  .strict();

// The geocode route can fail with map-provider errors OR route-level validation
// errors; both must satisfy the shared response schema (cycle-73 review-v1 ISSUE-1).
export const GEOCODE_ROUTE_ERROR_CODES = ["VALIDATION_ERROR", "NOT_FOUND", "LOCATION_MISSING"] as const;
export const GeocodeErrorCodeSchema = z.enum([...MAP_ERROR_CODES, ...GEOCODE_ROUTE_ERROR_CODES]);

export const EventGeocodeErrorSchema = z
  .object({ code: GeocodeErrorCodeSchema, message: z.string() })
  .strict();

export const EventGeocodeResponseSchema = z.union([
  z.object({ ok: z.literal(true), data: EventGeocodeDataSchema }).strict(),
  z.object({ ok: z.literal(false), error: EventGeocodeErrorSchema }).strict()
]);

export type MapProvider = z.infer<typeof MapProviderSchema>;
export type MapSmokeStatus = z.infer<typeof MapSmokeStatusSchema>;
export type MapErrorCode = z.infer<typeof MapErrorCodeSchema>;
export type MapProviderSmokeData = z.infer<typeof MapProviderSmokeDataSchema>;
export type MapProviderSmokeError = z.infer<typeof MapProviderSmokeErrorSchema>;
export type MapProviderSmokeResponse = z.infer<typeof MapProviderSmokeResponseSchema>;
export type GeocodeStatus = z.infer<typeof GeocodeStatusSchema>;
export type GeocodeConfidence = z.infer<typeof GeocodeConfidenceSchema>;
export type GeocodeCacheStatus = z.infer<typeof GeocodeCacheStatusSchema>;
export type GeocodeUncertainty = z.infer<typeof GeocodeUncertaintySchema>;
export type GeocodeErrorCode = z.infer<typeof GeocodeErrorCodeSchema>;
export type EventGeocodeData = z.infer<typeof EventGeocodeDataSchema>;
export type EventGeocodeError = z.infer<typeof EventGeocodeErrorSchema>;
export type EventGeocodeResponse = z.infer<typeof EventGeocodeResponseSchema>;
