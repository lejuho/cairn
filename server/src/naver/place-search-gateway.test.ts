import { describe, expect, it, vi } from "vitest";
import { createPlaceSearchGateway } from "./place-search-gateway.js";
import type { PlaceSearchConfigResult } from "./place-search-config.js";

const DISABLED: PlaceSearchConfigResult = { ok: true, config: { provider: "disabled" } };
const NAVER: PlaceSearchConfigResult = { ok: true, config: { provider: "naver", clientId: "CID", clientSecret: "SECRET_XYZ", baseUrl: "https://openapi.naver.com", timeoutMs: 1000 } };

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}
const item = (over: Record<string, unknown> = {}) => ({
  title: "<b>스타벅스</b> 강남",
  category: "카페>커피",
  address: "서울 강남구 역삼동 1",
  roadAddress: "서울 강남구 강남대로 390",
  link: "https://place.naver.com/1",
  description: "AT&amp;T &lt;b&gt;매장&lt;/b&gt;",
  mapx: "1271234567",
  mapy: "375045700",
  ...over
});

describe("createPlaceSearchGateway (cycle-79)", () => {
  it("disabled provider returns a scoped disabled error and does not fetch", async () => {
    const f = vi.fn();
    const gw = createPlaceSearchGateway(DISABLED, { fetchImpl: f as unknown as typeof fetch });
    expect(gw.provider).toBe("disabled");
    const r = await gw.search("강남");
    expect(f).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("disabled");
  });

  it("sends credentials as headers (never in the response) and strips highlights / decodes entities", async () => {
    let req: { url: URL; headers: Record<string, string> } | undefined;
    const f = vi.fn(async (url: URL, init: { headers: Record<string, string> }) => { req = { url, headers: init.headers }; return jsonResponse(200, { items: [item()] }); });
    const r = await createPlaceSearchGateway(NAVER, { fetchImpl: f as unknown as typeof fetch }).search("강남 카페");
    expect(req?.headers["X-Naver-Client-Id"]).toBe("CID");
    expect(req?.headers["X-Naver-Client-Secret"]).toBe("SECRET_XYZ");
    expect(req?.url.pathname).toBe("/v1/search/local.json");
    expect(req?.url.searchParams.get("display")).toBe("5");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.candidates[0]!;
      expect(c.title).toBe("스타벅스 강남"); // <b> stripped
      expect(c.description).toBe("AT&T 매장"); // entities decoded + nested tags stripped
      expect(c.naverUrl).toBe("https://place.naver.com/1");
      expect(c.locationText).toBe("스타벅스 강남 · 서울 강남구 강남대로 390");
      // No coordinate leaks anywhere in the candidate.
      expect(JSON.stringify(c)).not.toContain("1271234567");
      expect(JSON.stringify(c)).not.toContain("375045700");
      expect(c).not.toHaveProperty("mapx");
    }
  });

  it("falls back to a Naver search URL when the provider link is unsafe/missing", async () => {
    const f = vi.fn(async () => jsonResponse(200, { items: [item({ link: "javascript:alert(1)" }), item({ link: undefined })] }));
    const r = await createPlaceSearchGateway(NAVER, { fetchImpl: f as unknown as typeof fetch }).search("강남");
    if (r.ok) {
      for (const c of r.candidates) {
        expect(c.naverUrl.startsWith("https://map.naver.com/p/search/")).toBe(true);
        expect(c.naverUrl).not.toContain("javascript");
      }
    }
  });

  it("caps candidates at 5", async () => {
    const f = vi.fn(async () => jsonResponse(200, { items: Array.from({ length: 7 }, (_, i) => item({ title: `곳${i}` })) }));
    const r = await createPlaceSearchGateway(NAVER, { fetchImpl: f as unknown as typeof fetch }).search("강남");
    if (r.ok) expect(r.candidates.length).toBe(5);
  });

  it("maps 401/403→denied, 429→rate_limited, 5xx→unavailable, bad JSON/shape→invalid_response", async () => {
    const cases: [number, unknown, string][] = [
      [401, {}, "denied"], [403, {}, "denied"], [429, {}, "rate_limited"], [503, {}, "unavailable"]
    ];
    for (const [status, body, code] of cases) {
      const f = vi.fn(async () => jsonResponse(status, body));
      const r = await createPlaceSearchGateway(NAVER, { fetchImpl: f as unknown as typeof fetch, retryCount: 0 }).search("강남");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(code);
    }
    const fBad = vi.fn(async () => ({ status: 200, ok: true, json: async () => { throw new Error("bad"); } } as unknown as Response));
    const rBad = await createPlaceSearchGateway(NAVER, { fetchImpl: fBad as unknown as typeof fetch }).search("강남");
    if (!rBad.ok) expect(rBad.error.code).toBe("invalid_response");
    const fShape = vi.fn(async () => jsonResponse(200, { items: "nope" }));
    const rShape = await createPlaceSearchGateway(NAVER, { fetchImpl: fShape as unknown as typeof fetch }).search("강남");
    if (!rShape.ok) expect(rShape.error.code).toBe("invalid_response");
  });

  it("never leaks the API secret or Naver errorMessage in a scoped error", async () => {
    const f = vi.fn(async () => jsonResponse(401, { errorMessage: "key SECRET_XYZ invalid", errorCode: "024" }));
    const r = await createPlaceSearchGateway(NAVER, { fetchImpl: f as unknown as typeof fetch }).search("강남");
    if (!r.ok) {
      expect(JSON.stringify(r.error)).not.toContain("SECRET_XYZ");
      expect(JSON.stringify(r.error)).not.toContain("key SECRET_XYZ invalid");
    }
  });
});
