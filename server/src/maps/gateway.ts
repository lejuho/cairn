import { z } from "zod";
import type { MapErrorCode, MapProviderSmokeData, MapSmokeStatus } from "@cairn/shared";
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

export type MapGateway = { smoke: () => Promise<MapSmokeResult> };

export type MapGatewayOptions = { fetchImpl?: typeof fetch; retryCount?: number };

// Provider-specific shape — stays inside this gateway, never re-exported.
const GoogleGeocodeResponseSchema = z.object({
  status: z.string(),
  results: z.array(z.unknown()).optional(),
  error_message: z.string().optional()
});

export function createMapGateway(configResult: MapConfigResult, options: MapGatewayOptions = {}): MapGateway {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;

  return {
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
