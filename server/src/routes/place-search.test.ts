import { describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import type { PlaceSearchGateway, PlaceSearchResult } from "../naver/place-search-gateway.js";

// The place-search route is a provider boundary — it needs NO DB. buildServer is
// given only a fake place-search gateway (no db, no llm gateway, no map gateway).
function appWith(result: PlaceSearchResult, provider: "naver" | "disabled" = "naver") {
  const gateway: PlaceSearchGateway = { provider, search: async () => result };
  return buildServer(undefined, undefined, undefined, gateway);
}

const CANDIDATE = {
  title: "스타벅스 강남", category: "카페", address: "서울 강남구 역삼동 1", roadAddress: "서울 강남구 강남대로 390",
  description: null, naverUrl: "https://place.naver.com/1", locationText: "스타벅스 강남 · 서울 강남구 강남대로 390"
};

describe("GET /api/places/naver (cycle-79)", () => {
  it("returns sanitized candidates without a DB", async () => {
    const app = appWith({ ok: true, candidates: [CANDIDATE] });
    const res = await app.inject({ method: "GET", url: `/api/places/naver?query=${encodeURIComponent("강남 카페")}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ provider: "naver", candidates: [CANDIDATE] });
  });

  it("rejects a blank/too-short query with 400 validation_error", async () => {
    const app = appWith({ ok: true, candidates: [] });
    expect((await app.inject({ method: "GET", url: "/api/places/naver?query=" })).statusCode).toBe(400);
    const short = await app.inject({ method: "GET", url: "/api/places/naver?query=a" });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe("validation_error");
  });

  it("maps a disabled gateway to 503 disabled", async () => {
    const app = appWith({ ok: false, error: { code: "disabled", message: "Naver place search is disabled" } }, "disabled");
    const res = await app.inject({ method: "GET", url: "/api/places/naver?query=강남" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("disabled");
  });

  it("maps denied→502, rate_limited→429, unavailable→503", async () => {
    const expectStatus = async (code: "denied" | "rate_limited" | "unavailable", status: number) => {
      const app = appWith({ ok: false, error: { code, message: "x" } });
      const res = await app.inject({ method: "GET", url: "/api/places/naver?query=강남" });
      expect(res.statusCode).toBe(status);
      expect(res.json().error.code).toBe(code);
    };
    await expectStatus("denied", 502);
    await expectStatus("rate_limited", 429);
    await expectStatus("unavailable", 503);
  });

  it("is not registered when no place-search gateway is supplied (back-compat)", async () => {
    const res = await buildServer().inject({ method: "GET", url: "/api/places/naver?query=강남" });
    expect(res.statusCode).toBe(404);
  });
});
