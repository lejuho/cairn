import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadDetailSchema } from "@cairn/shared";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-ublk-"));
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
function insertEvent(conn: SqliteConnection, threadId: number | null, opts: { title?: string; start?: string | null; end?: string | null } = {}): number {
  return Number(
    conn.sqlite
      .prepare("INSERT INTO events (title, thread_id, source, self_imposed, status, start, end) VALUES (?,?, 'cairn',1,'planned', ?, ?)")
      .run(opts.title ?? "E", threadId, opts.start ?? null, opts.end ?? null).lastInsertRowid
  );
}
function insertTask(conn: SqliteConnection, threadId: number | null, opts: { title?: string; estMinutes?: number | null; due?: string | null } = {}): number {
  return Number(
    conn.sqlite.prepare("INSERT INTO tasks (title, thread_id, status, est_minutes, due, optional) VALUES (?,?,'todo',?,?,0)").run(opts.title ?? "T", threadId, opts.estMinutes ?? null, opts.due ?? null).lastInsertRowid
  );
}
function insertLink(conn: SqliteConnection, fromKind: string, fromId: number, toKind: string, toId: number, kind = "requires", firmness = "soft", source = "inferred"): void {
  conn.sqlite
    .prepare("INSERT INTO links (from_id, from_kind, to_id, to_kind, kind, firmness, source) VALUES (?,?,?,?,?,?,?)")
    .run(fromId, fromKind, toId, toKind, kind, firmness, source);
}

describe("GET /api/threads/:id unknownBlockers (cycle-52)", () => {
  it("returns a blocker for a normalized requires chain (missing prereq task estMinutes)", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "A");
    const e = insertEvent(conn, t, { title: "발표", start: "2026-06-20T10:00:00+09:00" });
    const task = insertTask(conn, t, { title: "슬라이드", estMinutes: null });
    insertLink(conn, "event", e, "task", task, "requires"); // event requires task → prereq=task, blocked=event
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${t}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json().data;
    expect(ThreadDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.unknownBlockers).toHaveLength(1);
    expect(detail.unknownBlockers[0]).toMatchObject({
      missingField: "task.estMinutes", blockedField: "event.start",
      prerequisite: { kind: "task", id: task, title: "슬라이드" },
      blockedNode: { kind: "event", id: e, title: "발표" }
    });
  });

  it("returns blockers for a normalized blocks chain (prereq event missing start/end)", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "A");
    const e = insertEvent(conn, t, { title: "준비", start: null, end: null });
    const task = insertTask(conn, t, { title: "제출", due: "2026-06-25" });
    insertLink(conn, "event", e, "task", task, "blocks"); // event blocks task → prereq=event, blocked=task
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t}` })).json().data;
    expect(detail.unknownBlockers.map((b: { missingField: string }) => b.missingField)).toEqual(["event.start", "event.end"]);
    expect(detail.unknownBlockers.every((b: { blockedField: string }) => b.blockedField === "task.due")).toBe(true);
  });

  it("excludes unrelated/cross-thread nodes and keeps existing detail fields", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    const e1 = insertEvent(conn, t1, { title: "발표", start: "2026-06-20T10:00:00+09:00" });
    const e2 = insertEvent(conn, t2, { title: "외부", start: "2026-06-21T10:00:00+09:00" });
    const taskOther = insertTask(conn, t2, { title: "남의 작업", estMinutes: null });
    insertLink(conn, "event", e1, "event", e2, "requires"); // cross-thread → excluded by findThreadNodeLinks
    insertLink(conn, "event", e2, "task", taskOther, "requires"); // entirely in t2
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t1}` })).json().data;
    expect(detail.unknownBlockers).toEqual([]);
    // existing fields still present + valid
    expect(ThreadDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.relations).toBeDefined();
    expect(detail.rollup).toBeDefined();
    expect(detail.nodeLinks).toBeDefined();
  });

  it("emits no blocker when the blocked node has no schedule/due target", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "A");
    const e = insertEvent(conn, t, { title: "발표", start: null }); // no start
    const task = insertTask(conn, t, { title: "슬라이드", estMinutes: null });
    insertLink(conn, "event", e, "task", task, "requires");
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t}` })).json().data;
    expect(detail.unknownBlockers).toEqual([]);
  });
});
