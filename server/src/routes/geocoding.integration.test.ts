import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { EventGeocodeResponseSchema, type MapErrorCode } from "@cairn/shared";
import type { GeocodeOutcome, MapGateway } from "../maps/gateway.js";

const tempDirs: string[] = [];
function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}
afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const RESOLVED_OUTCOME: GeocodeOutcome = {
  status: "resolved", latitude: 37.55, longitude: 126.98, displayLabel: "N Seoul Tower", providerResultId: "place_1",
  confidence: "high", providerStatus: "OK", uncertainty: { locationType: "ROOFTOP", partialMatch: false }
};

type MockOpts = { provider?: "google" | "disabled"; result?: { ok: true; outcome: GeocodeOutcome } | { ok: false; error: { code: MapErrorCode; message: string } } };
function mockGateway(opts: MockOpts = {}) {
  let calls = 0;
  const provider = opts.provider ?? "google";
  const gateway: MapGateway = {
    provider,
    smoke: async () => ({ ok: true, data: { provider: "disabled", configured: false, attempted: false, reachable: false, status: "disabled", resultCount: 0 } }),
    // Mirror the real gateway: a disabled gateway returns a `disabled` error
    // WITHOUT a provider HTTP call (no fetch is simulated here either).
    geocodeAddress: async () => {
      calls += 1;
      if (opts.result) return opts.result;
      if (provider === "disabled") return { ok: false, error: { code: "disabled", message: "Map provider is disabled" } };
      return { ok: true, outcome: RESOLVED_OUTCOME };
    }
  };
  return { gateway, calls: () => calls };
}

function insertEvent(conn: SqliteConnection, location: string | null): number {
  const r = conn.sqlite
    .prepare("INSERT INTO events (title, location, source, self_imposed, status) VALUES (?, ?, 'cairn', 1, 'planned')")
    .run("Meeting", location);
  return Number(r.lastInsertRowid);
}
const cacheCount = (conn: SqliteConnection) => (conn.sqlite.prepare("SELECT count(*) AS n FROM geocode_cache").get() as { n: number }).n;

describe("POST /api/events/:id/geocode (cycle-73)", () => {
  let conn: SqliteConnection;
  let app: FastifyInstance;
  let provCalls: () => number;
  function setup(opts: MockOpts = {}) {
    conn = makeTestDb();
    const m = mockGateway(opts);
    provCalls = m.calls;
    app = buildServer(conn.db, undefined, m.gateway);
  }

  it("rejects an invalid event id with 400", async () => {
    setup();
    const res = await app.inject({ method: "POST", url: "/api/events/0/geocode" });
    expect(res.statusCode).toBe(400);
  });

  it("unknown event → 404 with no provider call and no cache write", async () => {
    setup();
    const res = await app.inject({ method: "POST", url: "/api/events/999/geocode" });
    expect(res.statusCode).toBe(404);
    expect(provCalls()).toBe(0);
    expect(cacheCount(conn)).toBe(0);
  });

  it("blank location → 409 LOCATION_MISSING with no provider call and no cache write", async () => {
    setup();
    const id = insertEvent(conn, "   ");
    const res = await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("LOCATION_MISSING");
    expect(provCalls()).toBe(0);
    expect(cacheCount(conn)).toBe(0);
  });

  it("disabled provider → 503 disabled error, no cache write", async () => {
    setup({ provider: "disabled" });
    const id = insertEvent(conn, "Seoul Tower");
    const res = await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("disabled");
    // geocodeAddress owns the disabled mapping (short-circuits with no HTTP fetch
    // — the gateway unit test proves no fetch); the cache is never written.
    expect(cacheCount(conn)).toBe(0);
  });

  it("config-error gateway → 503 config_error (distinct from disabled), no cache write (review-v1 ISSUE-3)", async () => {
    setup({ result: { ok: false, error: { code: "config_error", message: "Map provider is misconfigured" } } });
    const id = insertEvent(conn, "Seoul Tower");
    const res = await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("config_error");
    expect(cacheCount(conn)).toBe(0);
  });

  it("rejects a non-integer id path segment (e.g. 1abc) with 400 and no provider/cache (review-v1 ISSUE-2)", async () => {
    setup();
    const res = await app.inject({ method: "POST", url: "/api/events/1abc/geocode" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(provCalls()).toBe(0);
    expect(cacheCount(conn)).toBe(0);
  });

  it("rejects a request body and unexpected query params with 400 (review-v1 ISSUE-2)", async () => {
    setup();
    const id = insertEvent(conn, "Seoul Tower");
    const withBody = await app.inject({ method: "POST", url: `/api/events/${id}/geocode`, payload: { address: "elsewhere" } });
    expect(withBody.statusCode).toBe(400);
    expect(withBody.json().error.code).toBe("VALIDATION_ERROR");
    const withQuery = await app.inject({ method: "POST", url: `/api/events/${id}/geocode?address=elsewhere` });
    expect(withQuery.statusCode).toBe(400);
    expect(provCalls()).toBe(0); // neither malformed request reached the provider
    expect(cacheCount(conn)).toBe(0);
  });

  it("400/404/409 and success responses all satisfy the shared EventGeocodeResponseSchema (review-v1 ISSUE-1)", async () => {
    setup();
    const id = insertEvent(conn, "Seoul Tower");
    const blankId = insertEvent(conn, "   ");
    const cases = [
      await app.inject({ method: "POST", url: "/api/events/1abc/geocode" }), // 400 VALIDATION_ERROR
      await app.inject({ method: "POST", url: "/api/events/999/geocode" }), // 404 NOT_FOUND
      await app.inject({ method: "POST", url: `/api/events/${blankId}/geocode` }), // 409 LOCATION_MISSING
      await app.inject({ method: "POST", url: `/api/events/${id}/geocode` }) // 200 success
    ];
    for (const res of cases) {
      expect(EventGeocodeResponseSchema.safeParse(res.json()).success).toBe(true);
    }
  });

  it("cache miss resolved → 200 miss/resolved with coords, one provider call, one cache row", async () => {
    setup();
    const id = insertEvent(conn, "Seoul Tower");
    const res = await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({ eventId: id, provider: "google", cacheStatus: "miss", status: "resolved", latitude: 37.55, longitude: 126.98, confidence: "high" });
    expect(body.data.normalizedLocation).toBe("seoul tower");
    expect(provCalls()).toBe(1);
    expect(cacheCount(conn)).toBe(1);
  });

  it("second call for an equivalent location → cache hit, no extra provider call, same row", async () => {
    setup();
    const id = insertEvent(conn, "Seoul Tower");
    const id2 = insertEvent(conn, "  SEOUL   tower "); // normalizes to the same key
    await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    const res2 = await app.inject({ method: "POST", url: `/api/events/${id2}/geocode` });
    expect(res2.json().data.cacheStatus).toBe("hit");
    expect(provCalls()).toBe(1); // provider called only on the first (miss)
    expect(cacheCount(conn)).toBe(1);
  });

  it("ambiguous outcome → 200 ambiguous with no coordinate, cached", async () => {
    setup({ result: { ok: true, outcome: { status: "ambiguous", providerStatus: "OK", uncertainty: { resultCount: 2, candidateLabels: ["A", "B"] } } } });
    const id = insertEvent(conn, "Tower");
    const res = await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    const body = res.json();
    expect(body.data).toMatchObject({ status: "ambiguous", latitude: null, longitude: null, confidence: "unknown" });
    expect(body.data.uncertainty).toEqual({ resultCount: 2, candidateLabels: ["A", "B"] });
    expect(cacheCount(conn)).toBe(1);
  });

  it("zero_results → 200 zero_results with no coordinate, cached", async () => {
    setup({ result: { ok: true, outcome: { status: "zero_results", providerStatus: "ZERO_RESULTS" } } });
    const id = insertEvent(conn, "nowhere xyz");
    const res = await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    expect(res.json().data).toMatchObject({ status: "zero_results", latitude: null, longitude: null });
    expect(cacheCount(conn)).toBe(1);
  });

  it("provider unavailable → 503 scoped error, no cache row written", async () => {
    setup({ result: { ok: false, error: { code: "unavailable", message: "Map provider is unavailable" } } });
    const id = insertEvent(conn, "Seoul Tower");
    const res = await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("unavailable");
    expect(cacheCount(conn)).toBe(0);
  });

  it("does not rewrite the event location", async () => {
    setup();
    const id = insertEvent(conn, "Seoul Tower");
    await app.inject({ method: "POST", url: `/api/events/${id}/geocode` });
    const loc = (conn.sqlite.prepare("SELECT location FROM events WHERE id = ?").get(id) as { location: string }).location;
    expect(loc).toBe("Seoul Tower");
  });
});
