import { z } from "zod";
import type { GeocodeConfidence, MapErrorCode, MapProvider, MapProviderSmokeData, MapSmokeStatus } from "@cairn/shared";
import type { GoogleMapConfig, MapConfigResult } from "./config.js";

// Single map provider gateway boundary (cycle-72). Mirrors the LLM gateway:
// AbortController timeout, bounded retry for transient `unavailable` only,
// injected `fetchImpl`. Provider-specific Google details live here; only
// provider-neutral diagnostics leave. Error messages are STATIC — the request
// URL, API key, and Google `error_message` are never surfaced or logged.

const GEOCODE_PATH = "/maps/api/geocode/json";
// Fixed smoke query — never user-supplied — so this diagnostic cannot become
// the Cycle 73 on-demand geocoding API.
const SMOKE_ADDRESS = "1600 Amphitheatre Parkway, Mountain View, CA";
const DEFAULT_RETRY_COUNT = 1;

export type MapGatewayError = { code: MapErrorCode; message: string };
export type MapSmokeResult =
  | { ok: true; data: MapProviderSmokeData }
  | { ok: false; error: MapGatewayError };

// Geocode outcomes (cycle-73). Provider-neutral; only label + place id + coord
// (when present) + a typed uncertainty object leave the gateway. `resolved`/
// `ambiguous`/`zero_results`/`failed` are cacheable facts; `{ ok:false, error }`
// is a transient/scoped failure the caller must NOT cache.
export type GeocodeUncertainty = { locationType?: string | null; partialMatch?: boolean; resultCount?: number; candidateLabels?: string[] };
export type GeocodeOutcome =
  | { status: "resolved"; latitude: number; longitude: number; displayLabel: string; providerResultId: string | null; confidence: GeocodeConfidence; providerStatus: string; uncertainty: GeocodeUncertainty }
  | { status: "ambiguous"; providerStatus: string; uncertainty: GeocodeUncertainty }
  | { status: "zero_results"; providerStatus: string }
  | { status: "failed"; providerStatus: string };
export type GeocodeResult = { ok: true; outcome: GeocodeOutcome } | { ok: false; error: MapGatewayError };

// Travel-time (cycle-76). Provider-neutral; only duration/distance + a status
// label leave the gateway. `resolved` carries a duration; `no_route` is a stable
// "no path" fact (cacheable). Transient/scoped failures are `{ok:false,error}`
// and must NOT be cached.
export type TravelPoint = { lat: number; lng: number };
export type TravelTimeOutcome =
  | { status: "resolved"; durationSeconds: number; distanceMeters: number | null; providerStatus: string }
  | { status: "no_route"; providerStatus: string };
export type TravelTimeResult = { ok: true; outcome: TravelTimeOutcome } | { ok: false; error: MapGatewayError };

export type MapGateway = {
  provider: MapProvider;
  smoke: () => Promise<MapSmokeResult>;
  geocodeAddress: (address: string) => Promise<GeocodeResult>;
  travelTime: (origin: TravelPoint, dest: TravelPoint, mode: string) => Promise<TravelTimeResult>;
};

export type MapGatewayOptions = { fetchImpl?: typeof fetch; retryCount?: number };

// Provider-specific shape — stays inside this gateway, never re-exported.
const GoogleGeocodeResponseSchema = z.object({
  status: z.string(),
  results: z.array(z.unknown()).optional(),
  error_message: z.string().optional()
});

// Richer shape for geocodeAddress — only the provider-neutral fields are read.
const GoogleResultSchema = z.object({
  formatted_address: z.string().optional(),
  place_id: z.string().optional(),
  partial_match: z.boolean().optional(),
  geometry: z
    .object({
      location: z.object({ lat: z.number(), lng: z.number() }).optional(),
      location_type: z.string().optional()
    })
    .optional()
});
const GoogleGeocodeFullSchema = z.object({
  status: z.string(),
  results: z.array(GoogleResultSchema).optional(),
  error_message: z.string().optional()
});

export function createMapGateway(configResult: MapConfigResult, options: MapGatewayOptions = {}): MapGateway {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;

  const provider: MapProvider = configResult.ok ? configResult.config.provider : "disabled";

  return {
    provider,
    async smoke(): Promise<MapSmokeResult> {
      if (!configResult.ok) {
        return failure("config_error", "Map provider is misconfigured");
      }
      const config = configResult.config;
      if (config.provider === "disabled") {
        return {
          ok: true,
          data: { provider: "disabled", configured: false, attempted: false, reachable: false, status: "disabled", resultCount: 0 }
        };
      }
      return smokeGoogle(config, fetchImpl, retryCount);
    },
    async geocodeAddress(address: string): Promise<GeocodeResult> {
      if (!configResult.ok) {
        return { ok: false, error: { code: "config_error", message: "Map provider is misconfigured" } };
      }
      const config = configResult.config;
      if (config.provider === "disabled") {
        return { ok: false, error: { code: "disabled", message: "Map provider is disabled" } };
      }
      return geocodeGoogle(config, address, fetchImpl, retryCount);
    },
    async travelTime(origin: TravelPoint, dest: TravelPoint, mode: string): Promise<TravelTimeResult> {
      if (!configResult.ok) {
        return { ok: false, error: { code: "config_error", message: "Map provider is misconfigured" } };
      }
      const config = configResult.config;
      if (config.provider === "disabled") {
        return { ok: false, error: { code: "disabled", message: "Map provider is disabled" } };
      }
      return travelTimeGoogle(config, origin, dest, mode, fetchImpl, retryCount);
    }
  };
}

function failure(code: MapErrorCode, message: string): MapSmokeResult {
  return { ok: false, error: { code, message } };
}

async function smokeGoogle(config: GoogleMapConfig, fetchImpl: typeof fetch, retryCount: number): Promise<MapSmokeResult> {
  const url = new URL(GEOCODE_PATH, ensureTrailingSlash(config.baseUrl));
  url.searchParams.set("address", SMOKE_ADDRESS);
  url.searchParams.set("key", config.apiKey);

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    // Fresh AbortController per attempt so a retry is not pre-aborted.
    const result = await smokeGoogleOnce(url, config.timeoutMs, fetchImpl);
    if (!result.ok && result.error.code === "unavailable" && attempt < retryCount) continue;
    return result;
  }
  return failure("unavailable", "Map provider is unavailable");
}

async function smokeGoogleOnce(url: URL, timeoutMs: number, fetchImpl: typeof fetch): Promise<MapSmokeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });

    if (response.status === 429) return failure("rate_limited", "Map provider rate limited the request");
    if (response.status >= 500) return failure("unavailable", "Map provider returned a server error");
    if (!response.ok) return failure("unavailable", "Map provider returned an unexpected HTTP status");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return failure("invalid_response", "Map provider returned invalid JSON");
    }
    const parsed = GoogleGeocodeResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return failure("invalid_response", "Map provider returned an unexpected response shape");
    }
    return mapGoogleStatus(parsed.data.status, parsed.data.results?.length ?? 0);
  } catch {
    // Timeout/abort and connection failures both land here → retryable.
    return failure("unavailable", "Map provider is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function mapGoogleStatus(status: string, resultCount: number): MapSmokeResult {
  switch (status) {
    case "OK":
      return { ok: true, data: googleData("ok", resultCount) };
    case "ZERO_RESULTS":
      return { ok: true, data: googleData("zero_results", 0) };
    case "OVER_QUERY_LIMIT":
      return failure("rate_limited", "Map provider query limit reached");
    case "OVER_DAILY_LIMIT":
    case "REQUEST_DENIED":
      return failure("denied", "Map provider denied the request");
    case "INVALID_REQUEST":
      return failure("invalid_request", "Map provider rejected the request as invalid");
    case "UNKNOWN_ERROR":
      return failure("unavailable", "Map provider reported a transient error");
    default:
      return failure("invalid_response", "Map provider returned an unrecognized status");
  }
}

function googleData(status: MapSmokeStatus, resultCount: number): MapProviderSmokeData {
  return { provider: "google", configured: true, attempted: true, reachable: true, status, resultCount };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

// ── geocodeAddress (cycle-73) ────────────────────────────────────────────────

function geocodeError(code: MapErrorCode, message: string): GeocodeResult {
  return { ok: false, error: { code, message } };
}

async function geocodeGoogle(config: GoogleMapConfig, address: string, fetchImpl: typeof fetch, retryCount: number): Promise<GeocodeResult> {
  const url = new URL(GEOCODE_PATH, ensureTrailingSlash(config.baseUrl));
  url.searchParams.set("address", address);
  url.searchParams.set("key", config.apiKey);

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const result = await geocodeGoogleOnce(url, config.timeoutMs, fetchImpl);
    if (!result.ok && result.error.code === "unavailable" && attempt < retryCount) continue;
    return result;
  }
  return geocodeError("unavailable", "Map provider is unavailable");
}

async function geocodeGoogleOnce(url: URL, timeoutMs: number, fetchImpl: typeof fetch): Promise<GeocodeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    if (response.status === 429) return geocodeError("rate_limited", "Map provider rate limited the request");
    if (response.status >= 500) return geocodeError("unavailable", "Map provider returned a server error");
    if (!response.ok) return geocodeError("unavailable", "Map provider returned an unexpected HTTP status");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return geocodeError("invalid_response", "Map provider returned invalid JSON");
    }
    const parsed = GoogleGeocodeFullSchema.safeParse(payload);
    if (!parsed.success) {
      return geocodeError("invalid_response", "Map provider returned an unexpected response shape");
    }
    return mapGeocodeStatus(parsed.data);
  } catch {
    return geocodeError("unavailable", "Map provider is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

type GoogleResult = z.infer<typeof GoogleResultSchema>;

function mapGeocodeStatus(data: z.infer<typeof GoogleGeocodeFullSchema>): GeocodeResult {
  const results = data.results ?? [];
  switch (data.status) {
    case "OK": {
      if (results.length === 1) {
        const r = results[0]!;
        const loc = r.geometry?.location;
        // OK with exactly one result but no coordinate is a degenerate stable
        // outcome — keep it honest as `failed` (no fabricated coordinate).
        if (!loc) return { ok: true, outcome: { status: "failed", providerStatus: "OK" } };
        return {
          ok: true,
          outcome: {
            status: "resolved",
            latitude: loc.lat,
            longitude: loc.lng,
            displayLabel: r.formatted_address ?? "",
            providerResultId: r.place_id ?? null,
            confidence: deriveConfidence(r.geometry?.location_type, r.partial_match),
            providerStatus: "OK",
            uncertainty: { locationType: r.geometry?.location_type ?? null, partialMatch: r.partial_match ?? false }
          }
        };
      }
      // Multiple results — preserve ambiguity; do NOT silently select a coordinate.
      return {
        ok: true,
        outcome: {
          status: "ambiguous",
          providerStatus: "OK",
          uncertainty: { resultCount: results.length, candidateLabels: candidateLabels(results) }
        }
      };
    }
    case "ZERO_RESULTS":
      return { ok: true, outcome: { status: "zero_results", providerStatus: "ZERO_RESULTS" } };
    // INVALID_REQUEST for a real (non-fixed) address is a stable per-address
    // failure → cacheable `failed`. (The cycle-72 smoke route maps the SAME
    // provider status to a scoped `invalid_request` error because its query is
    // a fixed constant — the divergence is intentional, not a bug.)
    case "INVALID_REQUEST":
      return { ok: true, outcome: { status: "failed", providerStatus: "INVALID_REQUEST" } };
    case "OVER_QUERY_LIMIT":
      return geocodeError("rate_limited", "Map provider query limit reached");
    case "OVER_DAILY_LIMIT":
    case "REQUEST_DENIED":
      return geocodeError("denied", "Map provider denied the request");
    case "UNKNOWN_ERROR":
      return geocodeError("unavailable", "Map provider reported a transient error");
    default:
      return geocodeError("invalid_response", "Map provider returned an unrecognized status");
  }
}

function candidateLabels(results: GoogleResult[]): string[] {
  return results.slice(0, 5).map((r) => r.formatted_address ?? "").filter((s) => s.length > 0);
}

function deriveConfidence(locationType: string | undefined, partialMatch: boolean | undefined): GeocodeConfidence {
  let base: GeocodeConfidence;
  switch (locationType) {
    case "ROOFTOP": base = "high"; break;
    case "RANGE_INTERPOLATED":
    case "GEOMETRIC_CENTER": base = "medium"; break;
    case "APPROXIMATE": base = "low"; break;
    default: base = "unknown";
  }
  // A partial match demotes one notch (never below low for a known type).
  if (partialMatch && base !== "unknown") {
    base = base === "high" ? "medium" : "low";
  }
  return base;
}

// ── travelTime (cycle-76) ────────────────────────────────────────────────────
// Google Distance Matrix (GET, same baseUrl as geocoding). Server-only; the
// request URL, API key, and provider error_message never leave this gateway.
const DISTANCE_MATRIX_PATH = "/maps/api/distancematrix/json";
const GOOGLE_TRAVEL_MODES: Record<string, string> = { drive: "driving", walk: "walking", transit: "transit", bike: "bicycling" };

const DistanceMatrixSchema = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  rows: z
    .array(
      z.object({
        elements: z.array(
          z.object({
            status: z.string(),
            duration: z.object({ value: z.number() }).optional(),
            distance: z.object({ value: z.number() }).optional()
          })
        )
      })
    )
    .optional()
});

function travelError(code: MapErrorCode, message: string): TravelTimeResult {
  return { ok: false, error: { code, message } };
}

async function travelTimeGoogle(config: GoogleMapConfig, origin: TravelPoint, dest: TravelPoint, mode: string, fetchImpl: typeof fetch, retryCount: number): Promise<TravelTimeResult> {
  const url = new URL(DISTANCE_MATRIX_PATH, ensureTrailingSlash(config.baseUrl));
  url.searchParams.set("origins", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destinations", `${dest.lat},${dest.lng}`);
  url.searchParams.set("mode", GOOGLE_TRAVEL_MODES[mode] ?? "driving");
  url.searchParams.set("key", config.apiKey);

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const result = await travelTimeOnce(url, config.timeoutMs, fetchImpl);
    if (!result.ok && result.error.code === "unavailable" && attempt < retryCount) continue;
    return result;
  }
  return travelError("unavailable", "Map provider is unavailable");
}

async function travelTimeOnce(url: URL, timeoutMs: number, fetchImpl: typeof fetch): Promise<TravelTimeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    if (response.status === 429) return travelError("rate_limited", "Map provider rate limited the request");
    if (response.status >= 500) return travelError("unavailable", "Map provider returned a server error");
    if (!response.ok) return travelError("unavailable", "Map provider returned an unexpected HTTP status");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return travelError("invalid_response", "Map provider returned invalid JSON");
    }
    const parsed = DistanceMatrixSchema.safeParse(payload);
    if (!parsed.success) return travelError("invalid_response", "Map provider returned an unexpected response shape");
    return mapDistanceMatrix(parsed.data);
  } catch {
    return travelError("unavailable", "Map provider is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function mapDistanceMatrix(data: z.infer<typeof DistanceMatrixSchema>): TravelTimeResult {
  switch (data.status) {
    case "OK":
      break;
    case "OVER_QUERY_LIMIT":
      return travelError("rate_limited", "Map provider query limit reached");
    case "OVER_DAILY_LIMIT":
    case "REQUEST_DENIED":
      return travelError("denied", "Map provider denied the request");
    case "INVALID_REQUEST":
      return travelError("invalid_request", "Map provider rejected the request as invalid");
    case "UNKNOWN_ERROR":
      return travelError("unavailable", "Map provider reported a transient error");
    default:
      return travelError("invalid_response", "Map provider returned an unrecognized status");
  }

  const element = data.rows?.[0]?.elements?.[0];
  if (!element) return travelError("invalid_response", "Map provider returned no route element");

  switch (element.status) {
    case "OK": {
      if (!element.duration) return travelError("invalid_response", "Map provider returned no duration");
      return {
        ok: true,
        outcome: { status: "resolved", durationSeconds: element.duration.value, distanceMeters: element.distance?.value ?? null, providerStatus: "OK" }
      };
    }
    case "ZERO_RESULTS":
    case "NOT_FOUND":
    case "MAX_ROUTE_LENGTH_EXCEEDED":
      return { ok: true, outcome: { status: "no_route", providerStatus: element.status } };
    default:
      return travelError("unavailable", "Map provider could not compute the route");
  }
}
