import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventRow, FeasibilityParams } from "@cairn/shared";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import type { MapGateway, TravelTimeResult } from "../maps/gateway.js";
import { buildDayTravelFacts } from "./travel-time.js";

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

const PARAMS: FeasibilityParams = { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 };
const NOW = "2026-06-20T12:00:00+00:00";

function ev(id: number, location: string | null, hour: number): EventRow {
  return {
    id, threadId: null, title: `e${id}`, type: null,
    start: `2026-06-20T${String(hour).padStart(2, "0")}:00:00+00:00`, end: `2026-06-20T${String(hour).padStart(2, "0")}:45:00+00:00`,
    location, mode: null, source: "cairn", selfImposed: 1, status: "planned", createdAt: null, updatedAt: null
  };
}
function fakeGateway(opts: { provider?: "google" | "disabled"; result?: TravelTimeResult } = {}) {
  let calls = 0;
  const provider = opts.provider ?? "google";
  const gw: MapGateway = {
    provider,
    smoke: async () => ({ ok: false, error: { code: "disabled", message: "n/a" } }),
    geocodeAddress: async () => ({ ok: false, error: { code: "disabled", message: "n/a" } }),
    travelTime: async () => { calls += 1; return opts.result ?? { ok: true, outcome: { status: "resolved", durationSeconds: 1440, distanceMeters: 8200, providerStatus: "OK" } }; }
  };
  return { gw, calls: () => calls };
}

describe("buildDayTravelFacts (cycle-76)", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  function seedGeo(norm: string, lat: number | null, lng: number | null, status = "resolved") {
    conn.sqlite
      .prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, latitude, longitude, confidence) VALUES ('google', ?, ?, ?, ?, ?, 'high')")
      .run(norm, norm, status, lat, lng);
  }
  const travelCount = () => (conn.sqlite.prepare("SELECT count(*) AS n FROM travel_time_cache").get() as { n: number }).n;
  const key = (a: number, b: number) => `${a}:${b}`;

  it("missing geocode → missing_geocode evidence, NO provider call/write", async () => {
    const { gw, calls } = fakeGateway();
    seedGeo("a", 37.5, 127.0); // only the first event resolves
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "a", 9), ev(2, "b", 10)], PARAMS, NOW, { allowProvider: true });
    expect(facts.get(key(1, 2))?.status).toBe("missing_geocode");
    expect(calls()).toBe(0);
    expect(travelCount()).toBe(0);
  });

  it("same normalized location → same_location, NO provider call", async () => {
    const { gw, calls } = fakeGateway();
    seedGeo("same place", 37.5, 127.0);
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "Same Place", 9), ev(2, "same place", 10)], PARAMS, NOW, { allowProvider: true });
    expect(facts.get(key(1, 2))?.status).toBe("same_location");
    expect(calls()).toBe(0);
  });

  it("cache miss with two resolved coords → ONE provider call, stores, fresh", async () => {
    const { gw, calls } = fakeGateway();
    seedGeo("a", 37.50, 127.00);
    seedGeo("b", 37.60, 127.10);
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "a", 9), ev(2, "b", 10)], PARAMS, NOW, { allowProvider: true });
    const t = facts.get(key(1, 2))!;
    expect(t.status).toBe("fresh");
    expect(t.durationMinutes).toBe(24);
    expect(calls()).toBe(1);
    expect(travelCount()).toBe(1);
  });

  it("a fresh cache hit is reused with NO provider call", async () => {
    const { gw, calls } = fakeGateway();
    seedGeo("a", 37.50, 127.00);
    seedGeo("b", 37.60, 127.10);
    conn.sqlite.prepare("INSERT INTO travel_time_cache (provider, mode, origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds, duration_minutes, distance_meters, status, last_checked_at) VALUES ('google','drive','a','b',37.5,127,37.6,127.1,900,15,5000,'resolved', ?)").run(NOW);
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "a", 9), ev(2, "b", 10)], PARAMS, NOW, { allowProvider: true });
    expect(facts.get(key(1, 2))).toMatchObject({ status: "fresh", durationMinutes: 15 });
    expect(calls()).toBe(0);
  });

  it("a stale cache hit with allowProvider=false stays stale, NO call/write (preview policy)", async () => {
    const { gw, calls } = fakeGateway();
    seedGeo("a", 37.50, 127.00);
    seedGeo("b", 37.60, 127.10);
    conn.sqlite.prepare("INSERT INTO travel_time_cache (provider, mode, origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds, duration_minutes, status, last_checked_at) VALUES ('google','drive','a','b',37.5,127,37.6,127.1,900,15,'resolved','2026-06-01T00:00:00+00:00')").run();
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "a", 9), ev(2, "b", 10)], PARAMS, NOW, { allowProvider: false });
    expect(facts.get(key(1, 2))?.status).toBe("stale");
    expect(calls()).toBe(0);
  });

  it("provider error → unavailable evidence and NO cache write (fail open)", async () => {
    const { gw } = fakeGateway({ result: { ok: false, error: { code: "unavailable", message: "x" } } });
    seedGeo("a", 37.50, 127.00);
    seedGeo("b", 37.60, 127.10);
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "a", 9), ev(2, "b", 10)], PARAMS, NOW, { allowProvider: true });
    expect(facts.get(key(1, 2))?.status).toBe("unavailable");
    expect(travelCount()).toBe(0);
  });

  it("provider no_route → unavailable evidence (never fresh) but caches the no_route fact", async () => {
    const { gw } = fakeGateway({ result: { ok: true, outcome: { status: "no_route", providerStatus: "ZERO_RESULTS" } } });
    seedGeo("a", 37.50, 127.00);
    seedGeo("b", 37.60, 127.10);
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "a", 9), ev(2, "b", 10)], PARAMS, NOW, { allowProvider: true });
    expect(facts.get(key(1, 2))).toMatchObject({ status: "unavailable", durationMinutes: null });
    expect(travelCount()).toBe(1); // no_route is a cacheable fact
  });

  it("disabled gateway → unavailable, NO provider call/write", async () => {
    const { gw, calls } = fakeGateway({ provider: "disabled" });
    seedGeo("a", 37.50, 127.00);
    seedGeo("b", 37.60, 127.10);
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "a", 9), ev(2, "b", 10)], PARAMS, NOW, { allowProvider: true });
    expect(facts.get(key(1, 2))?.status).toBe("unavailable");
    expect(calls()).toBe(0);
    expect(travelCount()).toBe(0);
  });

  it("dedupes identical location pairs → one provider call for a repeated pair", async () => {
    const { gw, calls } = fakeGateway();
    seedGeo("a", 37.50, 127.00);
    seedGeo("b", 37.60, 127.10);
    // a→b→a→b: the a→b pair repeats; b→a is a distinct direction.
    const facts = await buildDayTravelFacts(conn.db, gw, [ev(1, "a", 9), ev(2, "b", 10), ev(3, "a", 11), ev(4, "b", 12)], PARAMS, NOW, { allowProvider: true });
    expect(facts.get(key(1, 2))?.status).toBe("fresh");
    expect(facts.get(key(3, 4))?.status).toBe("fresh");
    expect(calls()).toBe(2); // a→b (deduped to 1) + b→a (1)
  });
});
