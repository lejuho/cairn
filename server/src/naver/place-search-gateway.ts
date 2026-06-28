import { z } from "zod";
import type { PlaceCandidate, PlaceSearchErrorCode } from "@cairn/shared";
import type { NaverPlaceConfig, PlaceSearchConfigResult } from "./place-search-config.js";

// Naver local-search gateway (cycle-79). Server-only: the client id/secret travel
// ONLY in request headers here and never leave this module. Error messages are
// STATIC — the request URL, credentials, and Naver `errorMessage` are never
// surfaced or logged. Candidate coordinates (`mapx`/`mapy`) are deliberately NOT
// read — this is place-candidate search, not geocoding.

const LOCAL_PATH = "/v1/search/local.json";
const DISPLAY = 5;
const DEFAULT_RETRY_COUNT = 1;

export type PlaceSearchGatewayError = { code: PlaceSearchErrorCode; message: string };
export type PlaceSearchResult = { ok: true; candidates: PlaceCandidate[] } | { ok: false; error: PlaceSearchGatewayError };
export type PlaceSearchGateway = { provider: "naver" | "disabled"; search: (query: string) => Promise<PlaceSearchResult> };
export type PlaceSearchGatewayOptions = { fetchImpl?: typeof fetch; retryCount?: number };

// Provider-specific shape — stays inside this gateway. `mapx`/`mapy` are NOT
// declared here so the coordinate fields can never reach the sanitized candidate.
const NaverLocalItemSchema = z.object({
  title: z.string().optional(),
  category: z.string().optional(),
  address: z.string().optional(),
  roadAddress: z.string().optional(),
  link: z.string().optional(),
  description: z.string().optional()
});
const NaverLocalResponseSchema = z.object({
  items: z.array(NaverLocalItemSchema).optional(),
  errorMessage: z.string().optional()
});

export function createPlaceSearchGateway(configResult: PlaceSearchConfigResult, options: PlaceSearchGatewayOptions = {}): PlaceSearchGateway {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
  const provider = configResult.config.provider;

  return {
    provider,
    async search(query: string): Promise<PlaceSearchResult> {
      const config = configResult.config;
      if (config.provider === "disabled") {
        return failure("disabled", "Naver place search is disabled");
      }
      return searchNaver(config, query, fetchImpl, retryCount);
    }
  };
}

function failure(code: PlaceSearchErrorCode, message: string): PlaceSearchResult {
  return { ok: false, error: { code, message } };
}

async function searchNaver(config: NaverPlaceConfig, query: string, fetchImpl: typeof fetch, retryCount: number): Promise<PlaceSearchResult> {
  const url = new URL(LOCAL_PATH, ensureTrailingSlash(config.baseUrl));
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(DISPLAY));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "random");

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const result = await searchNaverOnce(url, config, fetchImpl);
    if (!result.ok && result.error.code === "unavailable" && attempt < retryCount) continue;
    return result;
  }
  return failure("unavailable", "Naver place search is unavailable");
}

async function searchNaverOnce(url: URL, config: NaverPlaceConfig, fetchImpl: typeof fetch): Promise<PlaceSearchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "X-Naver-Client-Id": config.clientId, "X-Naver-Client-Secret": config.clientSecret },
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) return failure("denied", "Naver place search denied the request");
    if (response.status === 429) return failure("rate_limited", "Naver place search rate limited the request");
    if (response.status >= 500) return failure("unavailable", "Naver place search returned a server error");
    if (!response.ok) return failure("unavailable", "Naver place search returned an unexpected HTTP status");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return failure("invalid_response", "Naver place search returned invalid JSON");
    }
    const parsed = NaverLocalResponseSchema.safeParse(payload);
    if (!parsed.success) return failure("invalid_response", "Naver place search returned an unexpected response shape");

    const candidates = (parsed.data.items ?? [])
      .map((item) => toCandidate(item))
      .filter((c): c is PlaceCandidate => c != null)
      .slice(0, DISPLAY);
    return { ok: true, candidates };
  } catch {
    // Timeout/abort and connection failures both land here → retryable.
    return failure("unavailable", "Naver place search is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

type NaverLocalItem = z.infer<typeof NaverLocalItemSchema>;

function toCandidate(item: NaverLocalItem): PlaceCandidate | null {
  const title = sanitizeText(item.title);
  if (title.length === 0) return null;
  const category = sanitizeText(item.category);
  const address = sanitizeText(item.address);
  const roadAddress = sanitizeText(item.roadAddress);
  const description = sanitizeText(item.description);
  const where = roadAddress || address;
  const naverUrl = safeUrl(item.link) ?? `https://map.naver.com/p/search/${encodeURIComponent([title, where].filter(Boolean).join(" "))}`;
  const locationText = [title, where].filter((s) => s.length > 0).join(" · ");
  return {
    title,
    category,
    address,
    roadAddress,
    description: description.length > 0 ? description : null,
    naverUrl,
    locationText
  };
}

// Sanitize provider text: decode common HTML entities FIRST, then strip ALL tags
// (not just Naver's `<b>` highlight), then collapse whitespace — so no `<...>` tag
// can survive regardless of single/double encoding.
function sanitizeText(raw: string | undefined): string {
  if (!raw) return "";
  return decodeEntities(raw).replace(/<[^>]*>/g, "").trim().replace(/\s+/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Accept a provider link only when it parses as an http(s) URL (blocks
// `javascript:`/`data:`); otherwise the caller falls back to a Naver search URL.
function safeUrl(link: string | undefined): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.protocol === "http:" || u.protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
