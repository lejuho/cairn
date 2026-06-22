import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MirrorEnergyTrendDataSchema } from "@cairn/shared";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-energy-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertEvent(
  conn: SqliteConnection,
  opts: {
    title?: string;
    status?: string;
    start?: string | null;
    end?: string | null;
  } = {}
): number {
  const res = conn.sqlite
    .prepare(
      `INSERT INTO events (title, source, self_imposed, status, start, end)
       VALUES (?, 'cairn', 1, ?, ?, ?)`
    )
    .run(
      opts.title ?? "E",
      opts.status ?? "planned",
      opts.start ?? null,
      opts.end ?? null
    );
  return Number(res.lastInsertRowid);
}

describe("GET /api/mirror/energy-trends", () => {
  it("returns trend rows from real SQLite events", async () => {
    const conn = makeTestDb();
    insertEvent(conn, { start: "2026-06-22T09:00:00Z", end: "2026-06-22T11:00:00Z" });

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/energy-trends?from=2026-06-22&to=2026-06-22"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
    const data = MirrorEnergyTrendDataSchema.parse(body.data);
    expect(data.days).toHaveLength(1);
    expect(data.days[0]?.loadUnits).toBe(2);
    conn.sqlite.close();
  });

  it("excludes cancelled/done events", async () => {
    const conn = makeTestDb();
    insertEvent(conn, { status: "cancelled", start: "2026-06-22T09:00:00Z", end: "2026-06-22T11:00:00Z" });
    insertEvent(conn, { status: "done", start: "2026-06-22T12:00:00Z", end: "2026-06-22T14:00:00Z" });

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/energy-trends?from=2026-06-22&to=2026-06-22"
    });
    const data = MirrorEnergyTrendDataSchema.parse((res.json() as { data: unknown }).data);
    expect(data.days).toHaveLength(0);
    expect(data.summary.scheduledDays).toBe(0);
    conn.sqlite.close();
  });

  it("returns 400 on invalid date format", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/energy-trends?from=2026/06/22" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("returns 400 on impossible calendar date", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/energy-trends?from=2026-02-30" });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("returns 400 on reversed range", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/energy-trends?from=2026-06-30&to=2026-06-01"
    });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("returns 400 on range exceeding 90 days", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    // 2026-01-01 to 2026-04-01 = 90 diff days = 91 inclusive days > 90 limit
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/energy-trends?from=2026-01-01&to=2026-04-01"
    });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("returns 400 on one-sided from far in the past (bypasses schema cap)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    // schema only checks cap when both present; resolved to=today → diff huge
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/energy-trends?from=1900-01-01"
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("accepts one-sided to (from defaults to to-30d, within cap)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/energy-trends?to=2026-01-31"
    });
    // from=2026-01-01, to=2026-01-31 → diff=30 ≤ 89
    expect(res.statusCode).toBe(200);
    conn.sqlite.close();
  });

  it("uses DB param override for energy_budget", async () => {
    const conn = makeTestDb();
    conn.sqlite.prepare(`INSERT OR REPLACE INTO params (key, value) VALUES ('energy_budget', '1')`).run();
    insertEvent(conn, { start: "2026-06-22T09:00:00Z", end: "2026-06-22T11:00:00Z" }); // 2h load > 1 budget

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/energy-trends?from=2026-06-22&to=2026-06-22"
    });
    const data = MirrorEnergyTrendDataSchema.parse((res.json() as { data: unknown }).data);
    expect(data.summary.budgetUnits).toBe(1);
    expect(data.days[0]?.deficit).toBe(true);
    conn.sqlite.close();
  });

  it("works with no LLM gateway (deterministic route)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/energy-trends" });
    expect(res.statusCode).toBe(200);
    conn.sqlite.close();
  });
});
