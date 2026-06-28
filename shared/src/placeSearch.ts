import { z } from "zod";

// Naver place search (cycle-79). A small SANITIZED place-candidate list for an
// event's authored location — this is place-candidate search, NOT geocoding.
// Provider raw payloads, raw HTML highlights, raw provider error messages,
// credentials, request URLs, and candidate coordinates (Naver mapx/mapy) are
// intentionally NOT part of this contract. Choosing a candidate only updates the
// authored `events.location` text via the existing explicit edit route.

export const PLACE_SEARCH_ERROR_CODES = [
  "disabled",
  "denied",
  "rate_limited",
  "unavailable",
  "invalid_response",
  "validation_error"
] as const;
export const PlaceSearchErrorCodeSchema = z.enum(PLACE_SEARCH_ERROR_CODES);

// Route query validation (the visible event location text).
export const PlaceSearchQuerySchema = z
  .object({ query: z.string().trim().min(2).max(100) })
  .strict();

// A sanitized candidate. `.strict` keeps any raw provider field (mapx/mapy, raw
// HTML, link aliases, score/recommendation/autoApply) out of the contract.
export const PlaceCandidateSchema = z
  .object({
    title: z.string(),
    category: z.string(),
    address: z.string(),
    roadAddress: z.string(),
    description: z.string().nullable(),
    // http(s) only — a valid URL string with a `javascript:`/`data:` scheme is
    // rejected at the contract layer (defense in depth; the gateway also enforces it).
    naverUrl: z
      .string()
      .url()
      .refine((u) => {
        try {
          return ["http:", "https:"].includes(new URL(u).protocol);
        } catch {
          return false;
        }
      }, "naverUrl must be an http(s) URL"),
    locationText: z.string()
  })
  .strict();

export const PlaceSearchDataSchema = z
  .object({
    provider: z.literal("naver"),
    candidates: z.array(PlaceCandidateSchema).max(5)
  })
  .strict();

export const PlaceSearchResponseSchema = z.union([
  z.object({ ok: z.literal(true), data: PlaceSearchDataSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: PlaceSearchErrorCodeSchema, message: z.string() }).strict() }).strict()
]);

export type PlaceSearchErrorCode = z.infer<typeof PlaceSearchErrorCodeSchema>;
export type PlaceSearchQuery = z.infer<typeof PlaceSearchQuerySchema>;
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;
export type PlaceSearchData = z.infer<typeof PlaceSearchDataSchema>;
export type PlaceSearchResponse = z.infer<typeof PlaceSearchResponseSchema>;
