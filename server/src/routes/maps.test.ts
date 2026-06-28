import { describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import type { MapGateway, MapSmokeResult } from "../maps/gateway.js";

// The diagnostic route must work with NO DB and NO real network — buildServer
// is given only a fake map gateway (no db, no llm gateway).
function appWith(result: MapSmokeResult) {
  const gateway: MapGateway = { smoke: async () => result };
  return buildServer(undefined, undefined, gateway);
}

describe("GET /api/maps/provider-smoke (cycle-72)", () => {
  it("returns disabled success without a DB", async () => {
    const app = appWith({ ok: true, data: { provider: "disabled", configured: false, attempted: false, reachable: false, status: "disabled", resultCount: 0 } });
    const res = await app.inject({ method: "GET", url: "/api/maps/provider-smoke" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ provider: "disabled", configured: false, attempted: false, reachable: false, status: "disabled", resultCount: 0 });
  });

  it("returns configured/mock success without a DB", async () => {
    const app = appWith({ ok: true, data: { provider: "google", configured: true, attempted: true, reachable: true, status: "ok", resultCount: 1 } });
    const res = await app.inject({ method: "GET", url: "/api/maps/provider-smoke" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({ provider: "google", status: "ok", resultCount: 1 });
  });

  it("maps a provider failure to a typed 502 error without a DB", async () => {
    const app = appWith({ ok: false, error: { code: "denied", message: "Map provider denied the request" } });
    const res = await app.inject({ method: "GET", url: "/api/maps/provider-smoke" });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("denied");
  });

  it("maps a config_error to a 500 error", async () => {
    const app = appWith({ ok: false, error: { code: "config_error", message: "Map provider is misconfigured" } });
    const res = await app.inject({ method: "GET", url: "/api/maps/provider-smoke" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("config_error");
  });

  it("is not registered when no map gateway is supplied (back-compat)", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/maps/provider-smoke" });
    expect(res.statusCode).toBe(404);
  });
});
