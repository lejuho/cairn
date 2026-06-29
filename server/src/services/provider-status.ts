import type { ProviderStatusCode, ProviderStatusRow, ProviderStatusState } from "@cairn/shared";
import type { MapGateway } from "../maps/gateway.js";
import type { PlaceSearchGateway } from "../naver/place-search-gateway.js";

// Provider Status Badges A (cycle-82). Server-owned, TTL-cached aggregation over
// the EXISTING map/place-search gateways. It never forwards a provider's raw
// payload, URL, credential, or error message — only a provider-neutral code and
// static user-safe copy. No DB, no cron: a row is refreshed lazily on request
// once its TTL expires.

const DEFAULT_TTL_SECONDS = 300;
const NAVER_PROBE_QUERY = "강남역"; // fixed stable query; never user-supplied

// Static, user-safe Korean copy keyed by code. Provider error text is dropped.
const MESSAGES: Record<ProviderStatusCode, string> = {
  ok: "연결됨",
  disabled: "비활성",
  denied: "연결 거부됨",
  rate_limited: "요청 한도 초과",
  unavailable: "응답 없음",
  invalid_response: "응답 오류",
  config_error: "설정 오류"
};

function stateForCode(code: ProviderStatusCode): ProviderStatusState {
  if (code === "ok") return "connected";
  if (code === "disabled") return "disabled";
  return "degraded";
}

function row(id: "google" | "naver", label: string, code: ProviderStatusCode, checkedAt: string, ttlSeconds: number): ProviderStatusRow {
  return { id, label, state: stateForCode(code), code, checkedAt, ttlSeconds, message: MESSAGES[code] };
}

// Map a Google smoke result to a neutral code. Unknown/unmapped → unavailable
// (default-deny: never leak a provider-specific status).
async function googleCode(gateway: MapGateway): Promise<ProviderStatusCode> {
  const result = await gateway.smoke();
  if (result.ok) return result.data.status === "disabled" ? "disabled" : "ok";
  switch (result.error.code) {
    case "config_error": return "config_error";
    case "disabled": return "disabled";
    case "denied": return "denied";
    case "rate_limited": return "rate_limited";
    case "invalid_response":
    case "invalid_request": return "invalid_response";
    case "unavailable": return "unavailable";
    default: return "unavailable";
  }
}

async function naverCode(gateway: PlaceSearchGateway): Promise<ProviderStatusCode> {
  const result = await gateway.search(NAVER_PROBE_QUERY);
  if (result.ok) return "ok";
  switch (result.error.code) {
    case "disabled": return "disabled";
    case "denied": return "denied";
    case "rate_limited": return "rate_limited";
    case "invalid_response":
    case "validation_error": return "invalid_response";
    case "unavailable": return "unavailable";
    default: return "unavailable";
  }
}

export type ProviderStatusServiceOptions = {
  mapGateway: MapGateway;
  placeSearchGateway: PlaceSearchGateway;
  ttlSeconds?: number;
  now?: () => number;
};

export type ProviderStatusService = {
  getStatus: () => Promise<ProviderStatusRow[]>;
};

type CacheEntry = { row: ProviderStatusRow; expiresAt: number };

// A per-provider TTL cache means repeated frontend polling does not call upstream
// providers on every request. `now` is injectable for deterministic TTL tests.
export function createProviderStatusService(opts: ProviderStatusServiceOptions): ProviderStatusService {
  const ttlSeconds = opts.ttlSeconds && opts.ttlSeconds > 0 ? Math.floor(opts.ttlSeconds) : DEFAULT_TTL_SECONDS;
  const now = opts.now ?? (() => Date.now());
  const cache = new Map<"google" | "naver", CacheEntry>();

  async function resolve(id: "google" | "naver", label: string, codeFn: () => Promise<ProviderStatusCode>): Promise<ProviderStatusRow> {
    const cached = cache.get(id);
    const ts = now();
    if (cached && ts < cached.expiresAt) return cached.row;
    // A thrown gateway (unexpected) still becomes a safe degraded row, never a 500.
    let code: ProviderStatusCode;
    try {
      code = await codeFn();
    } catch {
      code = "unavailable";
    }
    const fresh = row(id, label, code, new Date(ts).toISOString(), ttlSeconds);
    cache.set(id, { row: fresh, expiresAt: ts + ttlSeconds * 1000 });
    return fresh;
  }

  return {
    async getStatus() {
      const google = await resolve("google", "Google", () => googleCode(opts.mapGateway));
      const naver = await resolve("naver", "Naver", () => naverCode(opts.placeSearchGateway));
      return [google, naver];
    }
  };
}
