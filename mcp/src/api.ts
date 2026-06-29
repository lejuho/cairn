import { isJsonObject, toJsonValue, type JsonObject, type JsonValue } from "./json.js";

export type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface CairnApiRequest {
  method: ApiMethod;
  path: string;
  query?: JsonObject;
  body?: JsonValue;
  timeoutMs?: number;
}

export interface CairnApiResponse {
  ok: boolean;
  status: number;
  statusText: string;
  data: JsonValue | null;
}

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface CairnApiClientConfig {
  baseUrl: string;
  bearerToken?: string;
  cookie?: string;
  fetchImpl?: FetchLike;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): CairnApiClientConfig {
  const bearerToken = trimToUndefined(env.CAIRN_API_BEARER_TOKEN);
  const cookie = trimToUndefined(env.CAIRN_API_COOKIE);
  return {
    baseUrl: trimToUndefined(env.CAIRN_API_BASE_URL) ?? "http://127.0.0.1:3100",
    ...(bearerToken !== undefined ? { bearerToken } : {}),
    ...(cookie !== undefined ? { cookie } : {})
  };
}

export function buildApiUrl(baseUrl: string, path: string, query?: JsonObject): URL {
  if (!path.startsWith("/api/") && path !== "/health") {
    throw new Error("path must start with /api/ or be /health");
  }
  if (path.startsWith("//") || path.includes("\\") || hasControlCharacter(path)) {
    throw new Error("path contains unsupported characters");
  }

  const base = new URL(baseUrl);
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("path must not change origin");

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      appendQuery(url, key, value);
    }
  }
  return url;
}

export async function requestCairnApi(config: CairnApiClientConfig, request: CairnApiRequest): Promise<CairnApiResponse> {
  const timeoutMs = clampTimeout(request.timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (config.bearerToken) headers.set("Authorization", `Bearer ${config.bearerToken}`);
  if (config.cookie) headers.set("Cookie", config.cookie);

  let body: string | undefined;
  if (request.body !== undefined) {
    if (request.method === "GET" || request.method === "DELETE") {
      throw new Error(`${request.method} requests must not include body`);
    }
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(request.body);
  }

  try {
    const fetchImpl = config.fetchImpl ?? fetch;
    const response = await fetchImpl(buildApiUrl(config.baseUrl, request.path, request.query), {
      method: request.method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body } : {})
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      data: parseResponseText(text)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function appendQuery(url: URL, key: string, value: JsonValue): void {
  if (value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(url, key, item);
    return;
  }
  if (isJsonObject(value)) {
    throw new Error(`query value for ${key} must be primitive or array`);
  }
  url.searchParams.append(key, String(value));
}

function parseResponseText(text: string): JsonValue | null {
  if (text.trim().length === 0) return null;
  try {
    return toJsonValue(JSON.parse(text));
  } catch {
    return text;
  }
}

function clampTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(60_000, Math.max(1_000, Math.trunc(value)));
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0 && code < 32) return true;
  }
  return false;
}
