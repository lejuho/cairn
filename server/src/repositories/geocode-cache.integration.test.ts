import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { findGeocodeByKey, upsertGeocode, type GeocodeCacheUpsert } from "./geocode-cache.js";

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

const RESOLVED: GeocodeCacheUpsert = {
  provider: "google", normalizedLocation: "seoul tower", locationText: "Seoul Tower", status: "resolved",
  latitude: 37.55, longitude: 126.98, displayLabel: "N Seoul Tower", providerResultId: "place_1",
  confidence: "high", providerStatus: "OK", uncertaintyJson: JSON.stringify({ locationType: "ROOFTOP", partialMatch: false })
};

describe("geocode-cache repository (cycle-73)", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("upsert writes one row and findByKey reads it back", () => {
    const row = upsertGeocode(conn.db, RESOLVED);
    expect(row.id).toBeTypeOf("number");
    expect(row.latitude).toBe(37.55);
    const found = findGeocodeByKey(conn.db, "google", "seoul tower");
    expect(found?.id).toBe(row.id);
    expect(findGeocodeByKey(conn.db, "google", "nowhere")).toBeNull();
  });

  it("upsert is idempotent on (provider, normalized_location) — no duplicate rows", () => {
    const first = upsertGeocode(conn.db, RESOLVED);
    const second = upsertGeocode(conn.db, { ...RESOLVED, displayLabel: "Updated Label" });
    expect(second.id).toBe(first.id); // same row reused
    expect(second.displayLabel).toBe("Updated Label"); // facts refreshed
    expect(second.updatedAt).not.toBeNull(); // update timestamp set on conflict
    const count = (conn.sqlite.prepare("SELECT count(*) AS n FROM geocode_cache").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("a different provider or normalized location is a distinct row", () => {
    upsertGeocode(conn.db, RESOLVED);
    upsertGeocode(conn.db, { ...RESOLVED, normalizedLocation: "busan tower" });
    const count = (conn.sqlite.prepare("SELECT count(*) AS n FROM geocode_cache").get() as { n: number }).n;
    expect(count).toBe(2);
  });

  it("unique index rejects a duplicate raw insert", () => {
    upsertGeocode(conn.db, RESOLVED);
    expect(() =>
      conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, confidence) VALUES ('google','seoul tower','x','zero_results','unknown')").run()
    ).toThrow();
  });

  it("CHECK rejects invalid status and confidence", () => {
    expect(() => conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, confidence) VALUES ('google','a','x','great','unknown')").run()).toThrow();
    expect(() => conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, confidence) VALUES ('google','b','x','resolved','perfect')").run()).toThrow();
  });

  it("CHECK rejects half-present coordinates (both-or-null)", () => {
    expect(() => conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, confidence, latitude) VALUES ('google','c','x','resolved','high', 37.5)").run()).toThrow();
    expect(() => conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, confidence, longitude) VALUES ('google','d','x','resolved','high', 127.0)").run()).toThrow();
    // both present is allowed
    expect(() => conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, confidence, latitude, longitude) VALUES ('google','e','x','resolved','high', 37.5, 127.0)").run()).not.toThrow();
  });
});
