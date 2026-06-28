// Map provider config (cycle-72). Parsed from environment only; defaults to
// `disabled` so server startup/tests need no map credentials. `google` requires
// MAP_PROVIDER_API_KEY — a blank/missing key is a typed config error, not a crash.

const DEFAULT_GOOGLE_BASE_URL = "https://maps.googleapis.com";
const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 15_000;

export type GoogleMapConfig = { provider: "google"; baseUrl: string; apiKey: string; timeoutMs: number };
export type MapProviderConfig = { provider: "disabled" } | GoogleMapConfig;

export type MapConfigResult =
  | { ok: true; config: MapProviderConfig }
  | { ok: false; code: "config_error"; message: string };

export function readMapConfig(env: NodeJS.ProcessEnv = process.env): MapConfigResult {
  const raw = env.MAP_PROVIDER?.trim();
  const provider = raw && raw.length > 0 ? raw : "disabled";

  if (provider === "disabled") {
    return { ok: true, config: { provider: "disabled" } };
  }
  if (provider !== "google") {
    return { ok: false, code: "config_error", message: `Unsupported MAP_PROVIDER value: ${provider}` };
  }

  const apiKey = env.MAP_PROVIDER_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, code: "config_error", message: "MAP_PROVIDER=google requires MAP_PROVIDER_API_KEY" };
  }

  const baseUrlRaw = env.MAP_PROVIDER_BASE_URL?.trim();
  const baseUrl = baseUrlRaw && baseUrlRaw.length > 0 ? baseUrlRaw : DEFAULT_GOOGLE_BASE_URL;
  return { ok: true, config: { provider: "google", baseUrl, apiKey, timeoutMs: parseTimeout(env.MAP_PROVIDER_TIMEOUT_MS) } };
}

// Blank/invalid → default; otherwise clamp to [MIN, MAX] so a hostile value
// cannot disable the timeout or hang the diagnostic call.
function parseTimeout(raw: string | undefined): number {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, n));
}
