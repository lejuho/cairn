import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { findPinnedByPair, listActivePinned, upsertPinned, type PinnedTransitUpsert } from "./pinned-transit-facts.js";
import { upsertPinnedTransitFact } from "../services/pinned-transit-facts.js";

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

const HOME_STATION: PinnedTransitUpsert = {
  originNormalized: "home", destNormalized: "station", originLabel: "집", destLabel: "역",
  originLat: 37.5, originLng: 127.0, destLat: 37.51, destLng: 127.02,
  mode: "public_transit", durationMinutes: 12, note: "9호선", source: "pinned_user"
};

describe("pinned-transit-facts repository (cycle-78)", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });
  const count = () => (conn.sqlite.prepare("SELECT count(*) AS n FROM pinned_transit_facts").get() as { n: number }).n;

  it("upsert writes one row; findPinnedByPair reads it back; listActivePinned lists it", () => {
    const row = upsertPinned(conn.db, HOME_STATION);
    expect(row.durationMinutes).toBe(12);
    expect(row.active).toBe(1);
    expect(findPinnedByPair(conn.db, "home", "station", "public_transit")?.id).toBe(row.id);
    expect(findPinnedByPair(conn.db, "home", "station", "drive")).toBeNull();
    expect(listActivePinned(conn.db)).toHaveLength(1);
  });

  it("re-pinning the same directional pair updates duration + last_confirmed_at without a duplicate", () => {
    const first = upsertPinned(conn.db, HOME_STATION);
    const second = upsertPinned(conn.db, { ...HOME_STATION, durationMinutes: 18, note: "지연" });
    expect(second.id).toBe(first.id);
    expect(second.durationMinutes).toBe(18);
    expect(second.updatedAt).not.toBeNull();
    expect(second.lastConfirmedAt).not.toBeNull();
    expect(count()).toBe(1);
  });

  it("A→B and B→A are distinct directional rows", () => {
    upsertPinned(conn.db, HOME_STATION);
    upsertPinned(conn.db, { ...HOME_STATION, originNormalized: "station", destNormalized: "home" });
    expect(count()).toBe(2);
  });

  it("CHECK rejects invalid mode / source / active / duration", () => {
    const ins = (cols: string, vals: string) => conn.sqlite.prepare(`INSERT INTO pinned_transit_facts (origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_minutes, ${cols}) VALUES ('a','b',1,1,2,2,10, ${vals})`).run();
    expect(() => ins("mode, source", "'drive','pinned_user'")).toThrow();
    expect(() => ins("mode, source", "'public_transit','provider'")).toThrow();
    expect(() => ins("mode, source, active", "'public_transit','pinned_user',2")).toThrow();
    expect(() => conn.sqlite.prepare("INSERT INTO pinned_transit_facts (origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_minutes, mode, source) VALUES ('a','b',1,1,2,2,0,'public_transit','pinned_user')").run()).toThrow();
    expect(() => conn.sqlite.prepare("INSERT INTO pinned_transit_facts (origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_minutes, mode, source) VALUES ('a','b',1,1,2,2,9999,'public_transit','pinned_user')").run()).toThrow();
  });

  it("unique pair+mode index rejects a duplicate raw insert", () => {
    upsertPinned(conn.db, HOME_STATION);
    expect(() => conn.sqlite.prepare("INSERT INTO pinned_transit_facts (origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_minutes, mode, source) VALUES ('home','station',1,1,2,2,12,'public_transit','pinned_user')").run()).toThrow();
  });
});

describe("upsertPinnedTransitFact service (cycle-78)", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });
  function event(location: string | null): number {
    const r = conn.sqlite.prepare("INSERT INTO events (title, location, source, self_imposed, status) VALUES ('E', ?, 'cairn', 1, 'planned')").run(location);
    return Number(r.lastInsertRowid);
  }
  function geo(norm: string, lat: number | null, lng: number | null, status = "resolved") {
    conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, latitude, longitude, display_label, confidence) VALUES ('google', ?, ?, ?, ?, ?, ?, 'high')").run(norm, norm, status, lat, lng, norm);
  }
  const factCount = () => (conn.sqlite.prepare("SELECT count(*) AS n FROM pinned_transit_facts").get() as { n: number }).n;

  it("404 not_found for an unknown event id, no write", () => {
    const id = event("집");
    const r = upsertPinnedTransitFact(conn.db, { fromEventId: id, toEventId: 9999, durationMinutes: 12 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("not_found");
    expect(factCount()).toBe(0);
  });

  it("location_missing when an endpoint has a blank location, no write", () => {
    const a = event("집"); const b = event("   ");
    const r = upsertPinnedTransitFact(conn.db, { fromEventId: a, toEventId: b, durationMinutes: 12 });
    if (!r.ok) expect(r.kind).toBe("location_missing");
    expect(factCount()).toBe(0);
  });

  it("location_unresolved when a geocode row is missing/unresolved, no provider call, no write", () => {
    const a = event("집"); const b = event("역");
    geo("집", 37.5, 127.0); // only origin resolved; dest "역" has no cache row
    const r = upsertPinnedTransitFact(conn.db, { fromEventId: a, toEventId: b, durationMinutes: 12 });
    if (!r.ok) expect(r.kind).toBe("location_unresolved");
    expect(factCount()).toBe(0);
  });

  it("success: derives pair identity + coordinates from geocode cache and returns a user-authored fact", () => {
    const a = event("집"); const b = event("역");
    geo("집", 37.5, 127.0); geo("역", 37.51, 127.02);
    const r = upsertPinnedTransitFact(conn.db, { fromEventId: a, toEventId: b, durationMinutes: 12, note: "9호선" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({ originNormalized: "집", destNormalized: "역", durationMinutes: 12, mode: "public_transit", source: "pinned_user", active: true, note: "9호선" });
      expect(r.data.originLat).toBe(37.5); // server-derived, not browser-supplied
      expect(r.data.destLng).toBe(127.02);
    }
    expect(factCount()).toBe(1);
  });

  it("re-pin updates the existing fact (duration + last_confirmed) without a duplicate", () => {
    const a = event("집"); const b = event("역");
    geo("집", 37.5, 127.0); geo("역", 37.51, 127.02);
    upsertPinnedTransitFact(conn.db, { fromEventId: a, toEventId: b, durationMinutes: 12 });
    const r2 = upsertPinnedTransitFact(conn.db, { fromEventId: a, toEventId: b, durationMinutes: 20 });
    if (r2.ok) {
      expect(r2.data.durationMinutes).toBe(20);
      expect(r2.data.lastConfirmedAt).not.toBeNull();
    }
    expect(factCount()).toBe(1);
  });
});
