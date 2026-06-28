// Naver place-search config (cycle-79). Parsed from environment only; defaults to
// `disabled` so server startup/tests need no Naver credentials. Both
// NAVER_SEARCH_CLIENT_ID and NAVER_SEARCH_CLIENT_SECRET must be present and
// non-blank to enable; a missing credential is fail-soft `disabled`, not a crash.
// Credentials live ONLY in this server-side config + the gateway.

const DEFAULT_BASE_URL = "https://openapi.naver.com";
const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 15_000;

export type NaverPlaceConfig = {
  provider: "naver";
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  timeoutMs: number;
};
export type PlaceSearchProviderConfig = { provider: "disabled" } | NaverPlaceConfig;
export type PlaceSearchConfigResult = { ok: true; config: PlaceSearchProviderConfig };

export function readPlaceSearchConfig(env: NodeJS.ProcessEnv = process.env): PlaceSearchConfigResult {
  const clientId = env.NAVER_SEARCH_CLIENT_ID?.trim();
  const clientSecret = env.NAVER_SEARCH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { ok: true, config: { provider: "disabled" } };
  }
  const baseUrlRaw = env.NAVER_SEARCH_BASE_URL?.trim();
  const baseUrl = baseUrlRaw && baseUrlRaw.length > 0 ? baseUrlRaw : DEFAULT_BASE_URL;
  return { ok: true, config: { provider: "naver", clientId, clientSecret, baseUrl, timeoutMs: parseTimeout(env.NAVER_SEARCH_TIMEOUT_MS) } };
}

function parseTimeout(raw: string | undefined): number {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, n));
}
