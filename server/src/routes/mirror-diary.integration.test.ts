import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-mirror-diary-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertEvent(conn: SqliteConnection, opts: { title?: string; threadId?: number | null; start?: string | null } = {}): number {
  const res = conn.sqlite
    .prepare(`INSERT INTO events (title, thread_id, start, source, self_imposed, status) VALUES (?, ?, ?, 'cairn', 1, 'planned')`)
    .run(opts.title ?? "테스트 이벤트", opts.threadId ?? null, opts.start ?? "2026-06-21T10:00:00+09:00");
  return Number(res.lastInsertRowid);
}

function insertAnnotation(
  conn: SqliteConnection,
  eventId: number,
  outcome: string,
  loggedAt: string,
  opts: { reasonText?: string | null } = {}
): number {
  const res = conn.sqlite
    .prepare(`INSERT INTO annotations (event_id, outcome, reason_text, logged_at) VALUES (?, ?, ?, ?)`)
    .run(eventId, outcome, opts.reasonText ?? null, loggedAt);
  return Number(res.lastInsertRowid);
}

function insertThread(conn: SqliteConnection, name: string): number {
  const res = conn.sqlite.prepare(`INSERT INTO threads (name) VALUES (?)`).run(name);
  return Number(res.lastInsertRowid);
}

describe("GET /api/mirror/diary", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("returns empty days when no annotations", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/diary?from=2026-06-01&to=2026-06-30"
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.days).toHaveLength(0);
    expect(data.sampleStatus).toBe("low_sample");
    expect(data.range).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("returns 400 for reversed from/to", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/diary?from=2026-06-30&to=2026-06-01"
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for >90-day range", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/diary?from=2026-01-01&to=2026-04-01"
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for overflow date (2026-02-30)", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/diary?from=2026-02-30"
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns diary day with entries from real DB annotations joined to events", async () => {
    const app = buildServer(conn.db);
    const evtId = insertEvent(conn, { title: "팀 회의" });
    insertAnnotation(conn, evtId, "moved", "2026-06-21 09:00:00", { reasonText: "회의 장소 변경" });

    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/diary?from=2026-06-01&to=2026-06-30"
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.days).toHaveLength(1);
    const day = data.days[0];
    expect(day.date).toBe("2026-06-21");
    expect(day.headline).toBe("회의 장소 변경");
    expect(day.entries).toHaveLength(1);
    const entry = day.entries[0];
    expect(entry.outcome).toBe("moved");
    expect(entry.reasonText).toBe("회의 장소 변경");
    expect(entry.depth).toBe("semi_auto");
    expect(entry.contextLabel).toBe("팀 회의 / 이동");
    expect(entry.thread).toBeNull();
  });

  it("includes thread when event has a thread", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "프로젝트 A");
    const evtId = insertEvent(conn, { title: "기획 회의", threadId });
    insertAnnotation(conn, evtId, "done", "2026-06-21 09:00:00");

    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/diary?from=2026-06-01&to=2026-06-30"
    });
    const entry = res.json().data.days[0]!.entries[0]!;
    expect(entry.thread).toEqual({ id: threadId, name: "프로젝트 A" });
  });

  it("excludes annotations outside requested range", async () => {
    const app = buildServer(conn.db);
    const evtId = insertEvent(conn);
    insertAnnotation(conn, evtId, "moved", "2026-05-01 09:00:00");

    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/diary?from=2026-06-01&to=2026-06-30"
    });
    expect(res.json().data.days).toHaveLength(0);
  });

  it("groups multiple entries per day correctly", async () => {
    const app = buildServer(conn.db);
    const e1 = insertEvent(conn, { title: "이벤트1" });
    const e2 = insertEvent(conn, { title: "이벤트2" });
    insertAnnotation(conn, e1, "moved", "2026-06-21 08:00:00");
    insertAnnotation(conn, e2, "cancelled", "2026-06-21 10:00:00");

    const res = await app.inject({
      method: "GET",
      url: "/api/mirror/diary?from=2026-06-01&to=2026-06-30"
    });
    const { data } = res.json();
    expect(data.days).toHaveLength(1);
    expect(data.days[0].entries).toHaveLength(2);
  });

  it("route is read-only — two GETs return identical results", async () => {
    const app = buildServer(conn.db);
    const evtId = insertEvent(conn);
    insertAnnotation(conn, evtId, "moved", "2026-06-21 09:00:00");

    const url = "/api/mirror/diary?from=2026-06-01&to=2026-06-30";
    const res1 = await app.inject({ method: "GET", url });
    const res2 = await app.inject({ method: "GET", url });
    expect(res1.json().data.days).toHaveLength(1);
    expect(res2.json().data.days).toHaveLength(1);
    expect(res2.json().data.days[0].entries).toHaveLength(1);
  });
});
