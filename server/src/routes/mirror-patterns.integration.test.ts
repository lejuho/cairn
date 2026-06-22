import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MirrorPatternsDataSchema } from "@cairn/shared";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-patterns-"));
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
    threadId?: number | null;
    start?: string | null;
    type?: string | null;
    cancelMoney?: number;
    cancelSocial?: number;
    cancelEffort?: string | null;
    cancelWindow?: string | null;
  } = {}
): number {
  const res = conn.sqlite
    .prepare(
      `INSERT INTO events (title, thread_id, start, type, source, self_imposed, status,
        cancel_money, cancel_social, cancel_effort, cancel_window)
       VALUES (?, ?, ?, ?, 'cairn', 1, 'planned', ?, ?, ?, ?)`
    )
    .run(
      opts.title ?? "E",
      opts.threadId ?? null,
      opts.start ?? null,
      opts.type ?? null,
      opts.cancelMoney ?? 0,
      opts.cancelSocial ?? 0,
      opts.cancelEffort ?? "none",
      opts.cancelWindow ?? null
    );
  return Number(res.lastInsertRowid);
}

function insertAnnotation(
  conn: SqliteConnection,
  eventId: number | null,
  outcome: string,
  loggedAt: string
): number {
  const res = conn.sqlite
    .prepare(
      `INSERT INTO annotations (event_id, outcome, logged_at) VALUES (?, ?, ?)`
    )
    .run(eventId, outcome, loggedAt);
  return Number(res.lastInsertRowid);
}

function insertThread(conn: SqliteConnection, name: string): number {
  const res = conn.sqlite.prepare(`INSERT INTO threads (name) VALUES (?)`).run(name);
  return Number(res.lastInsertRowid);
}

describe("GET /api/mirror/patterns", () => {
  it("returns all three bucket collections from real SQLite rows", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "프로젝트");
    const ev = insertEvent(conn, {
      title: "팀 회의",
      threadId,
      start: "2026-06-22T10:00:00+09:00",
      type: "meet"
    });
    insertAnnotation(conn, ev, "done", "2026-06-22 09:00:00");
    insertAnnotation(conn, ev, "moved", "2026-06-20 09:00:00");

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/patterns?from=2026-06-01&to=2026-06-30"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
    const data = MirrorPatternsDataSchema.parse(body.data);
    expect(data.totals.annotations).toBe(2);
    expect(data.totals.done).toBe(1);
    expect(data.totals.moved).toBe(1);
    expect(data.weekday.length).toBeGreaterThan(0);
    expect(data.type.length).toBeGreaterThan(0);
    expect(data.thread.length).toBeGreaterThan(0);
    conn.sqlite.close();
  });

  it("includes done annotations (not only moved/cancelled)", async () => {
    const conn = makeTestDb();
    const ev = insertEvent(conn, {});
    insertAnnotation(conn, ev, "done", "2026-06-22 09:00:00");

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/patterns?from=2026-06-01&to=2026-06-30"
    });
    const data = MirrorPatternsDataSchema.parse((res.json() as { data: unknown }).data);
    expect(data.totals.done).toBe(1);
    conn.sqlite.close();
  });

  it("excludes annotations with missing event join", async () => {
    const conn = makeTestDb();
    insertAnnotation(conn, null, "done", "2026-06-22 09:00:00");

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/patterns?from=2026-06-01&to=2026-06-30"
    });
    const data = MirrorPatternsDataSchema.parse((res.json() as { data: unknown }).data);
    expect(data.totals.annotations).toBe(0);
    conn.sqlite.close();
  });

  it("returns 400 on invalid date format", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/patterns?from=2026/06/01" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("returns 400 on impossible calendar date (2026-99-99)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/patterns?from=2026-99-99" });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("returns 400 on overflow calendar date (2026-02-30)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/patterns?to=2026-02-30" });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("returns 400 on reversed range", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/patterns?from=2026-06-30&to=2026-06-01"
    });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("works with no LLM gateway (deterministic route)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/patterns" });
    expect(res.statusCode).toBe(200);
    conn.sqlite.close();
  });

  it("puts null-start event in unknown weekday bucket", async () => {
    const conn = makeTestDb();
    const ev = insertEvent(conn, { start: null });
    insertAnnotation(conn, ev, "done", "2026-06-22 09:00:00");

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/patterns?from=2026-06-01&to=2026-06-30"
    });
    const data = MirrorPatternsDataSchema.parse((res.json() as { data: unknown }).data);
    const unknown = data.weekday.find((b) => b.key === "unknown");
    expect(unknown?.total).toBe(1);
    conn.sqlite.close();
  });

  it("uses thread:null bucket for threadless events", async () => {
    const conn = makeTestDb();
    const ev = insertEvent(conn, { threadId: null });
    insertAnnotation(conn, ev, "done", "2026-06-22 09:00:00");

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/patterns?from=2026-06-01&to=2026-06-30"
    });
    const data = MirrorPatternsDataSchema.parse((res.json() as { data: unknown }).data);
    const nullThread = data.thread.find((b) => b.key === "thread:null");
    expect(nullThread?.thread).toBeNull();
    conn.sqlite.close();
  });
});
