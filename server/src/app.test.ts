import { describe, expect, it } from "vitest";
import { buildServer } from "./app.js";

describe("GET /health", () => {
  it("returns the public health shape", async () => {
    const app = buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        service: "cairn-server",
        status: "ok"
      }
    });
  });
});

describe("GET /api/session/return", () => {
  it("sends the browser back to the same-site path it came from", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/session/return?to=${encodeURIComponent("/notes?date=2026-11-12")}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/notes?date=2026-11-12");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("falls back to Today instead of redirecting off-site", async () => {
    const app = buildServer();
    for (const to of ["https://evil.example/", "//evil.example", "/\\evil.example", "today", ""]) {
      const res = await app.inject({ method: "GET", url: `/api/session/return?to=${encodeURIComponent(to)}` });
      expect(res.headers.location).toBe("/today");
    }
    const none = await app.inject({ method: "GET", url: "/api/session/return" });
    expect(none.headers.location).toBe("/today");
  });
});
