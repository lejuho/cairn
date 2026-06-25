import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MirrorTransitionFrictionDataSchema } from "@cairn/shared";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-friction-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertThread(conn: SqliteConnection, name: string): number {
  return Number(conn.sqlite.prepare("INSERT INTO threads (name) VALUES (?)").run(name).lastInsertRowid);
}

function insertEvent(conn: SqliteConnection, threadId: number | null, start: string, status = "planned"): number {
  return Number(
    conn.sqlite
      .prepare("INSERT INTO events (title, thread_id, source, self_imposed, status, start, end) VALUES ('E', ?, 'cairn', 1, ?, ?, ?)")
      .run(threadId, status, start, start).lastInsertRowid
  );
}

function insertThreadLink(conn: SqliteConnection, fromThread: number, toThread: number, kind: string, firmness = "soft"): void {
  conn.sqlite
    .prepare("INSERT INTO thread_links (from_thread, to_thread, kind, firmness) VALUES (?, ?, ?, ?)")
    .run(fromThread, toThread, kind, firmness);
}

function insertAnnotation(conn: SqliteConnection, eventId: number, outcome: string | null, loggedAt: string, energyAtTime: number | null): void {
  conn.sqlite
    .prepare("INSERT INTO annotations (event_id, outcome, energy_at_time, logged_at) VALUES (?, ?, ?, ?)")
    .run(eventId, outcome, energyAtTime, loggedAt);
}

const D1 = "2026-06-20";

describe("GET /api/mirror/transition-friction", () => {
  it("returns deterministic day rows from events/thread_links/annotations", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertThreadLink(conn, t1, t2, "contains"); // context link → low
    const e1 = insertEvent(conn, t1, `${D1}T09:00:00+09:00`);
    insertEvent(conn, t2, `${D1}T10:00:00+09:00`);
    insertAnnotation(conn, e1, "done", `${D1}T11:00:00+09:00`, 4);

    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/mirror/transition-friction?from=${D1}&to=${D1}` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(MirrorTransitionFrictionDataSchema.safeParse(data).success).toBe(true);
    expect(data.range).toEqual({ from: D1, to: D1 });
    expect(data.days).toHaveLength(1);
    const day = data.days[0];
    expect(day.date).toBe(D1);
    expect(day.transitionPairs).toBe(1);
    expect(day.contextPairs).toBe(1);
    expect(day.lowTransitionPairs).toBe(1);
    expect(day.outcomes.done).toBe(1);
    expect(day.energy).toEqual({ entryCount: 1, averageEnergyAtTime: 4 });
  });

  it("defaults to a ~30 day window when from/to omitted", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/transition-friction" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.summary.days).toBe(31);
  });

  it("rejects malformed dates, reversed range, and >90-day range with 400", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    for (const url of [
      "/api/mirror/transition-friction?from=2026-13-01&to=2026-06-20",
      "/api/mirror/transition-friction?from=2026/06/20",
      "/api/mirror/transition-friction?from=2026-06-30&to=2026-06-01",
      "/api/mirror/transition-friction?from=2026-01-01&to=2026-06-01"
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("does not mutate events, annotations, thread_links, or params", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const e1 = insertEvent(conn, t1, `${D1}T09:00:00+09:00`);
    insertEvent(conn, t1, `${D1}T10:00:00+09:00`);
    insertAnnotation(conn, e1, "moved", `${D1}T11:00:00+09:00`, 2);
    const count = (t: string) => (conn.sqlite.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
    const before = { events: count("events"), annotations: count("annotations"), threadLinks: count("thread_links"), params: count("params") };

    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/mirror/transition-friction?from=${D1}&to=${D1}` });
    expect(res.statusCode).toBe(200);
    const after = { events: count("events"), annotations: count("annotations"), threadLinks: count("thread_links"), params: count("params") };
    expect(after).toEqual(before);
  });

  it("succeeds without any model proxy configuration (deterministic read-only route)", async () => {
    // The route never touches the model gateway, so a 200 with no proxy
    // configured proves the deterministic path stands alone.
    const conn = makeTestDb();
    insertEvent(conn, insertThread(conn, "A"), `${D1}T09:00:00+09:00`);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/mirror/transition-friction?from=${D1}&to=${D1}` });
    expect(res.statusCode).toBe(200);
  });
});
