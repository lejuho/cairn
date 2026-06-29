import { describe, it, expect } from "vitest";
import { ProviderStatusResponseSchema } from "@cairn/shared";
import { createProviderStatusService } from "./provider-status.js";
import type { MapGateway, MapSmokeResult } from "../maps/gateway.js";
import type { PlaceSearchGateway, PlaceSearchResult } from "../naver/place-search-gateway.js";
import { buildServer } from "../app.js";

function fakeMap(result: MapSmokeResult) {
  let calls = 0;
  const gw = { provider: "google", smoke: async () => { calls += 1; return result; } } as unknown as MapGateway;
  return { gw, calls: () => calls };
}
function fakePlace(result: PlaceSearchResult) {
  let calls = 0;
  const gw = { provider: "naver", search: async () => { calls += 1; return result; } } as unknown as PlaceSearchGateway;
  return { gw, calls: () => calls };
}
const smokeOk: MapSmokeResult = { ok: true, data: { status: "ok" } as MapSmokeResult extends { ok: true; data: infer D } ? D : never };
const smokeDisabled: MapSmokeResult = { ok: false, error: { code: "disabled", message: "MAP_PROVIDER=disabled" } };
const placeOk: PlaceSearchResult = { ok: true, candidates: [] };
const placeDisabled: PlaceSearchResult = { ok: false, error: { code: "disabled", message: "Naver place search is disabled" } };

describe("provider-status service (cycle-82)", () => {
  it("maps Google smoke ok/disabled and Naver search ok/disabled to neutral rows", async () => {
    const svc = createProviderStatusService({ mapGateway: fakeMap(smokeOk).gw, placeSearchGateway: fakePlace(placeOk).gw });
    const [g, n] = await svc.getStatus();
    expect(g).toMatchObject({ id: "google", label: "Google", state: "connected", code: "ok", message: "연결됨", ttlSeconds: 300 });
    expect(n).toMatchObject({ id: "naver", label: "Naver", state: "connected", code: "ok" });
    expect(() => new Date(g!.checkedAt).toISOString()).not.toThrow();

    const svc2 = createProviderStatusService({ mapGateway: fakeMap(smokeDisabled).gw, placeSearchGateway: fakePlace(placeDisabled).gw });
    const [g2, n2] = await svc2.getStatus();
    expect(g2).toMatchObject({ state: "disabled", code: "disabled" });
    expect(n2).toMatchObject({ state: "disabled", code: "disabled" });
  });

  it("maps each degraded Google/Naver error code without leaking provider text", async () => {
    const googleCases: [string, string][] = [["config_error", "config_error"], ["denied", "denied"], ["rate_limited", "rate_limited"], ["invalid_request", "invalid_response"], ["invalid_response", "invalid_response"], ["unavailable", "unavailable"]];
    for (const [errCode, code] of googleCases) {
      const svc = createProviderStatusService({ mapGateway: fakeMap({ ok: false, error: { code: errCode, message: "SECRET key=AIzaXYZ at maps.googleapis.com" } } as MapSmokeResult).gw, placeSearchGateway: fakePlace(placeOk).gw });
      const [g] = await svc.getStatus();
      expect(g).toMatchObject({ state: "degraded", code });
      expect(JSON.stringify(g)).not.toContain("AIzaXYZ");
      expect(JSON.stringify(g)).not.toContain("googleapis");
    }
    const naverCases: [string, string][] = [["denied", "denied"], ["rate_limited", "rate_limited"], ["unavailable", "unavailable"], ["invalid_response", "invalid_response"], ["validation_error", "invalid_response"]];
    for (const [errCode, code] of naverCases) {
      const svc = createProviderStatusService({ mapGateway: fakeMap(smokeOk).gw, placeSearchGateway: fakePlace({ ok: false, error: { code: errCode, message: "X-Naver-Client-Secret leaked" } } as PlaceSearchResult).gw });
      const [, n] = await svc.getStatus();
      expect(n).toMatchObject({ state: "degraded", code });
      expect(JSON.stringify(n)).not.toContain("X-Naver");
    }
  });

  it("a thrown gateway becomes a safe degraded 'unavailable' row, not a crash", async () => {
    const gw = { provider: "google", smoke: async () => { throw new Error("boom"); } } as unknown as MapGateway;
    const svc = createProviderStatusService({ mapGateway: gw, placeSearchGateway: fakePlace(placeOk).gw });
    const [g] = await svc.getStatus();
    expect(g).toMatchObject({ state: "degraded", code: "unavailable" });
  });

  it("reuses cached rows within TTL: no second gateway call (call-counting fake + injected now)", async () => {
    const map = fakeMap(smokeOk);
    const place = fakePlace(placeOk);
    let clock = 1_000_000;
    const svc = createProviderStatusService({ mapGateway: map.gw, placeSearchGateway: place.gw, ttlSeconds: 300, now: () => clock });
    await svc.getStatus();
    expect(map.calls()).toBe(1);
    expect(place.calls()).toBe(1);
    clock += 299_000; // within TTL
    await svc.getStatus();
    expect(map.calls()).toBe(1); // cached — no new upstream call
    expect(place.calls()).toBe(1);
    clock += 2_000; // now past 300s TTL
    await svc.getStatus();
    expect(map.calls()).toBe(2); // re-checked after expiry
    expect(place.calls()).toBe(2);
  });
});

describe("GET /api/providers/status (cycle-82)", () => {
  it("returns exactly two rows (google, naver) in a schema-valid envelope with no raw leak", async () => {
    const app = buildServer(undefined, undefined, fakeMap(smokeOk).gw, fakePlace(placeDisabled).gw);
    const res = await app.inject({ method: "GET", url: "/api/providers/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ProviderStatusResponseSchema.safeParse(body).success).toBe(true);
    expect(body.data.providers.map((p: { id: string }) => p.id)).toEqual(["google", "naver"]);
    const raw = JSON.stringify(body);
    for (const leak of ["apiKey", "clientSecret", "X-Naver", "errorMessage", "googleapis", "강남역"]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("is absent (404) when gateways are not provided", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/providers/status" });
    expect(res.statusCode).toBe(404);
  });
});
