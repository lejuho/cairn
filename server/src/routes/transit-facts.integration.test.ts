import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

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

describe("PUT /api/transit-facts/pair (cycle-78)", () => {
  let conn: SqliteConnection;
  let app: FastifyInstance;
  beforeEach(() => { conn = makeTestDb(); app = buildServer(conn.db); });

  const event = (location: string | null): number =>
    Number(conn.sqlite.prepare("INSERT INTO events (title, location, source, self_imposed, status) VALUES ('E', ?, 'cairn', 1, 'planned')").run(location).lastInsertRowid);
  const geo = (norm: string, lat: number, lng: number) =>
    conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, latitude, longitude, display_label, confidence) VALUES ('google', ?, ?, 'resolved', ?, ?, ?, 'high')").run(norm, norm, lat, lng, norm);
  const put = (payload: Record<string, unknown>) => app.inject({ method: "PUT", url: "/api/transit-facts/pair", payload });
  const factCount = () => (conn.sqlite.prepare("SELECT count(*) AS n FROM pinned_transit_facts").get() as { n: number }).n;

  it("400 VALIDATION_ERROR for a missing duration or a browser-supplied coordinate", async () => {
    const a = event("집"); const b = event("역");
    expect((await put({ fromEventId: a, toEventId: b })).statusCode).toBe(400);
    const withCoord = await put({ fromEventId: a, toEventId: b, durationMinutes: 12, fromLat: 37.5 });
    expect(withCoord.statusCode).toBe(400); // .strict rejects coordinate fields
    expect(withCoord.json().error.code).toBe("VALIDATION_ERROR");
    expect(factCount()).toBe(0);
  });

  it("404 for unknown event, 409 LOCATION_MISSING for blank, 409 LOCATION_UNRESOLVED for no geocode — no write each", async () => {
    const a = event("집"); const blank = event("   "); const b = event("역");
    expect((await put({ fromEventId: a, toEventId: 9999, durationMinutes: 12 })).statusCode).toBe(404);
    const miss = await put({ fromEventId: a, toEventId: blank, durationMinutes: 12 });
    expect(miss.statusCode).toBe(409);
    expect(miss.json().error.code).toBe("LOCATION_MISSING");
    geo("집", 37.5, 127.0); // origin resolved, dest "역" unresolved
    const unres = await put({ fromEventId: a, toEventId: b, durationMinutes: 12 });
    expect(unres.statusCode).toBe(409);
    expect(unres.json().error.code).toBe("LOCATION_UNRESOLVED");
    expect(factCount()).toBe(0);
  });

  it("200 success returns a user-authored fact (server-derived coords); re-pin updates without a duplicate", async () => {
    const a = event("집"); const b = event("역");
    geo("집", 37.5, 127.0); geo("역", 37.51, 127.02);
    const res = await put({ fromEventId: a, toEventId: b, durationMinutes: 12, note: "9호선" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ originNormalized: "집", destNormalized: "역", durationMinutes: 12, mode: "public_transit", source: "pinned_user", active: true, originLat: 37.5, destLng: 127.02 });
    expect(factCount()).toBe(1);

    const res2 = await put({ fromEventId: a, toEventId: b, durationMinutes: 20 });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().data.durationMinutes).toBe(20);
    expect(res2.json().data.lastConfirmedAt).not.toBeNull();
    expect(factCount()).toBe(1); // re-pin updated the same row
  });
});
