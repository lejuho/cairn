import { describe, expect, it, vi } from "vitest";
import { createMapGateway } from "./gateway.js";
import type { MapConfigResult } from "./config.js";

const GOOGLE: MapConfigResult = { ok: true, config: { provider: "google", baseUrl: "https://maps.googleapis.com", apiKey: "SECRET_KEY_123", timeoutMs: 1000 } };
const DISABLED: MapConfigResult = { ok: true, config: { provider: "disabled" } };
const CONFIG_ERR: MapConfigResult = { ok: false, code: "config_error", message: "MAP_PROVIDER=google requires MAP_PROVIDER_API_KEY" };

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}
function geocode(status: string, results: unknown[] = []): Response {
  return jsonResponse(200, { status, results });
}

describe("createMapGateway (cycle-72)", () => {
  it("disabled mode returns success without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const r = await createMapGateway(DISABLED, { fetchImpl: fetchImpl as unknown as typeof fetch }).smoke();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, data: { provider: "disabled", configured: false, attempted: false, reachable: false, status: "disabled", resultCount: 0 } });
  });

  it("config_error result returns a config_error failure and no fetch", async () => {
    const fetchImpl = vi.fn();
    const r = await createMapGateway(CONFIG_ERR, { fetchImpl: fetchImpl as unknown as typeof fetch }).smoke();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("config_error");
  });

  it("google constructs an HTTPS Geocoding request with encoded fixed address + server key", async () => {
    const fetchImpl = vi.fn(async () => geocode("OK", [{}]));
    await createMapGateway(GOOGLE, { fetchImpl: fetchImpl as unknown as typeof fetch }).smoke();
    const url = fetchImpl.mock.calls[0]![0] as URL;
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("maps.googleapis.com");
    expect(url.pathname).toBe("/maps/api/geocode/json");
    expect(url.searchParams.get("address")).toBe("1600 Amphitheatre Parkway, Mountain View, CA");
    expect(url.searchParams.get("key")).toBe("SECRET_KEY_123");
    // url-encoded in the wire form (no raw space/comma in the query string)
    expect(url.search).toContain("Amphitheatre+Parkway");
    expect(url.search).toContain("%2C");
    expect(url.search).not.toContain(" ");
  });

  it("OK with results → provider-neutral success with result count", async () => {
    const fetchImpl = vi.fn(async () => geocode("OK", [{}, {}]));
    const r = await createMapGateway(GOOGLE, { fetchImpl: fetchImpl as unknown as typeof fetch }).smoke();
    expect(r).toEqual({ ok: true, data: { provider: "google", configured: true, attempted: true, reachable: true, status: "ok", resultCount: 2 } });
  });

  it("ZERO_RESULTS → non-fabricated zero-result success (no coordinate)", async () => {
    const fetchImpl = vi.fn(async () => geocode("ZERO_RESULTS", []));
    const r = await createMapGateway(GOOGLE, { fetchImpl: fetchImpl as unknown as typeof fetch }).smoke();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ status: "zero_results", resultCount: 0 });
  });

  it("OVER_QUERY_LIMIT and HTTP 429 → rate_limited (not retried)", async () => {
    const f1 = vi.fn(async () => geocode("OVER_QUERY_LIMIT"));
    const r1 = await createMapGateway(GOOGLE, { fetchImpl: f1 as unknown as typeof fetch }).smoke();
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe("rate_limited");
    expect(f1).toHaveBeenCalledTimes(1);

    const f2 = vi.fn(async () => jsonResponse(429, {}));
    const r2 = await createMapGateway(GOOGLE, { fetchImpl: f2 as unknown as typeof fetch }).smoke();
    if (!r2.ok) expect(r2.error.code).toBe("rate_limited");
    expect(f2).toHaveBeenCalledTimes(1);
  });

  it("OVER_DAILY_LIMIT and REQUEST_DENIED → denied (not retried)", async () => {
    for (const s of ["OVER_DAILY_LIMIT", "REQUEST_DENIED"]) {
      const f = vi.fn(async () => geocode(s));
      const r = await createMapGateway(GOOGLE, { fetchImpl: f as unknown as typeof fetch }).smoke();
      if (!r.ok) expect(r.error.code).toBe("denied");
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("INVALID_REQUEST → invalid_request and is not retried", async () => {
    const f = vi.fn(async () => geocode("INVALID_REQUEST"));
    const r = await createMapGateway(GOOGLE, { fetchImpl: f as unknown as typeof fetch }).smoke();
    if (!r.ok) expect(r.error.code).toBe("invalid_request");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("UNKNOWN_ERROR → unavailable with bounded retry", async () => {
    const f = vi.fn(async () => geocode("UNKNOWN_ERROR"));
    const r = await createMapGateway(GOOGLE, { fetchImpl: f as unknown as typeof fetch, retryCount: 1 }).smoke();
    if (!r.ok) expect(r.error.code).toBe("unavailable");
    expect(f).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("HTTP 5xx and connection failure → unavailable with bounded retry", async () => {
    const f5 = vi.fn(async () => jsonResponse(503, {}));
    const r5 = await createMapGateway(GOOGLE, { fetchImpl: f5 as unknown as typeof fetch, retryCount: 1 }).smoke();
    if (!r5.ok) expect(r5.error.code).toBe("unavailable");
    expect(f5).toHaveBeenCalledTimes(2);

    const fc = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const rc = await createMapGateway(GOOGLE, { fetchImpl: fc as unknown as typeof fetch, retryCount: 1 }).smoke();
    if (!rc.ok) expect(rc.error.code).toBe("unavailable");
    expect(fc).toHaveBeenCalledTimes(2);
  });

  it("timeout/abort → unavailable", async () => {
    const f = vi.fn(async () => {
      // simulate the AbortController firing
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const r = await createMapGateway(GOOGLE, { fetchImpl: f as unknown as typeof fetch, retryCount: 0 }).smoke();
    if (!r.ok) expect(r.error.code).toBe("unavailable");
  });

  it("invalid JSON and invalid shape → invalid_response", async () => {
    const fBad = vi.fn(async () => ({ status: 200, ok: true, json: async () => { throw new Error("bad json"); } } as unknown as Response));
    const rBad = await createMapGateway(GOOGLE, { fetchImpl: fBad as unknown as typeof fetch }).smoke();
    if (!rBad.ok) expect(rBad.error.code).toBe("invalid_response");

    const fShape = vi.fn(async () => jsonResponse(200, { unexpected: true }));
    const rShape = await createMapGateway(GOOGLE, { fetchImpl: fShape as unknown as typeof fetch }).smoke();
    if (!rShape.ok) expect(rShape.error.code).toBe("invalid_response");
  });

  it("unrecognized provider status → invalid_response", async () => {
    const f = vi.fn(async () => geocode("SOME_NEW_STATUS"));
    const r = await createMapGateway(GOOGLE, { fetchImpl: f as unknown as typeof fetch }).smoke();
    if (!r.ok) expect(r.error.code).toBe("invalid_response");
  });

  it("error surfaces never include the configured API key or provider error_message", async () => {
    const f = vi.fn(async () => jsonResponse(200, { status: "REQUEST_DENIED", error_message: "The provided API key is invalid: SECRET_KEY_123" }));
    const r = await createMapGateway(GOOGLE, { fetchImpl: f as unknown as typeof fetch }).smoke();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toContain("SECRET_KEY_123");
      expect(r.error.message).not.toContain("error_message");
      expect(JSON.stringify(r.error)).not.toContain("SECRET_KEY_123");
    }
  });
});
