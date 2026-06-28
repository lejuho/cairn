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

export type MapProvider = z.infer<typeof MapProviderSchema>;
export type MapSmokeStatus = z.infer<typeof MapSmokeStatusSchema>;
export type MapErrorCode = z.infer<typeof MapErrorCodeSchema>;
export type MapProviderSmokeData = z.infer<typeof MapProviderSmokeDataSchema>;
export type MapProviderSmokeError = z.infer<typeof MapProviderSmokeErrorSchema>;
export type MapProviderSmokeResponse = z.infer<typeof MapProviderSmokeResponseSchema>;
