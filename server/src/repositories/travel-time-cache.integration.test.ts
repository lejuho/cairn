import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { findTravelByKey, upsertTravel, type TravelCacheUpsert } from "./travel-time-cache.js";

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

const RESOLVED: TravelCacheUpsert = {
  provider: "google", mode: "drive", originNormalized: "seoul tower", destNormalized: "busan tower",
  originLat: 37.55, originLng: 126.98, destLat: 35.1, destLng: 129.0,
  durationSeconds: 1440, durationMinutes: 24, distanceMeters: 8200, status: "resolved", providerStatus: "OK"
};

describe("travel-time-cache repository (cycle-76)", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });
  const count = () => (conn.sqlite.prepare("SELECT count(*) AS n FROM travel_time_cache").get() as { n: number }).n;

  it("upsert writes one row, findByKey reads it back", () => {
    const row = upsertTravel(conn.db, RESOLVED);
    expect(row.durationSeconds).toBe(1440);
    expect(findTravelByKey(conn.db, "google", "drive", "seoul tower", "busan tower")?.id).toBe(row.id);
    expect(findTravelByKey(conn.db, "google", "drive", "x", "y")).toBeNull();
  });

  it("upsert is idempotent on the (provider, mode, origin, dest) key", () => {
    const first = upsertTravel(conn.db, RESOLVED);
    const second = upsertTravel(conn.db, { ...RESOLVED, durationSeconds: 1800, durationMinutes: 30 });
    expect(second.id).toBe(first.id);
    expect(second.durationMinutes).toBe(30);
    expect(second.updatedAt).not.toBeNull();
    expect(count()).toBe(1);
  });

  it("different mode or direction is a distinct row", () => {
    upsertTravel(conn.db, RESOLVED);
    upsertTravel(conn.db, { ...RESOLVED, mode: "walk" });
    upsertTravel(conn.db, { ...RESOLVED, originNormalized: "busan tower", destNormalized: "seoul tower" });
    expect(count()).toBe(3);
  });

  it("stores a no_route fact with null duration", () => {
    const row = upsertTravel(conn.db, { ...RESOLVED, durationSeconds: null, durationMinutes: null, distanceMeters: null, status: "no_route", providerStatus: "ZERO_RESULTS" });
    expect(row.status).toBe("no_route");
    expect(row.durationSeconds).toBeNull();
  });

  it("CHECK rejects an invalid status", () => {
    expect(() => conn.sqlite.prepare("INSERT INTO travel_time_cache (provider, mode, origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds, status) VALUES ('google','drive','a','b',1,1,2,2,100,'maybe')").run()).toThrow();
  });

  it("CHECK rejects a resolved row missing a duration", () => {
    expect(() => conn.sqlite.prepare("INSERT INTO travel_time_cache (provider, mode, origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, status) VALUES ('google','drive','a','b',1,1,2,2,'resolved')").run()).toThrow();
    // no_route without a duration is allowed
    expect(() => conn.sqlite.prepare("INSERT INTO travel_time_cache (provider, mode, origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, status) VALUES ('google','drive','a','b',1,1,2,2,'no_route')").run()).not.toThrow();
  });

  it("unique index rejects a duplicate raw insert", () => {
    upsertTravel(conn.db, RESOLVED);
    expect(() => conn.sqlite.prepare("INSERT INTO travel_time_cache (provider, mode, origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds, status) VALUES ('google','drive','seoul tower','busan tower',1,1,2,2,100,'resolved')").run()).toThrow();
  });
});
