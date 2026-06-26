import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-tnode-"));
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
function insertEvent(conn: SqliteConnection, threadId: number | null, opts: { title?: string; source?: string; status?: string; start?: string | null } = {}): number {
  return Number(
    conn.sqlite
      .prepare("INSERT INTO events (title, thread_id, source, self_imposed, status, start, end, type, location, mode) VALUES (?,?,?,1,?,?,?, 'meet','회의실','in_person')")
      .run(opts.title ?? "E", threadId, opts.source ?? "cairn", opts.status ?? "planned", opts.start ?? "2026-06-20T09:00:00+09:00", opts.start ?? "2026-06-20T10:00:00+09:00").lastInsertRowid
  );
}
function insertTask(conn: SqliteConnection, threadId: number | null, title = "T"): number {
  return Number(
    conn.sqlite.prepare("INSERT INTO tasks (title, thread_id, status, est_minutes, due, context, optional) VALUES (?,?,'todo',30,'2026-06-20','old',0)").run(title, threadId).lastInsertRowid
  );
}
function insertLink(conn: SqliteConnection, fromKind: string, fromId: number, toKind: string, toId: number, opts: { kind?: string; firmness?: string; source?: string } = {}): number {
  return Number(
    conn.sqlite
      .prepare("INSERT INTO links (from_id, from_kind, to_id, to_kind, kind, firmness, source) VALUES (?,?,?,?,?,?,?)")
      .run(fromId, fromKind, toId, toKind, opts.kind ?? "requires", opts.firmness ?? "soft", opts.source ?? "inferred").lastInsertRowid
  );
}
const col = (conn: SqliteConnection, table: string, id: number, c: string) =>
  (conn.sqlite.prepare(`SELECT ${c} v FROM ${table} WHERE id=?`).get(id) as { v: unknown }).v;

describe("PATCH /api/events/:id/thread-node", () => {
  it("updates only title/type/location/mode and leaves start/end/status/threadId/source unchanged", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "A");
    const e = insertEvent(conn, t);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: `/api/events/${e}/thread-node`, payload: { title: "새 제목", mode: "remote", location: null } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.event.title).toBe("새 제목");
    expect(res.json().data.event.mode).toBe("remote");
    expect(res.json().data.event.location).toBeNull();
    // untouched columns
    expect(col(conn, "events", e, "start")).toBe("2026-06-20T09:00:00+09:00");
    expect(col(conn, "events", e, "status")).toBe("planned");
    expect(col(conn, "events", e, "thread_id")).toBe(t);
    expect(col(conn, "events", e, "source")).toBe("cairn");
  });

  it("rejects empty patch, blank title, bad mode, unknown field, bad id, unknown id", async () => {
    const conn = makeTestDb();
    const e = insertEvent(conn, insertThread(conn, "A"));
    const app = buildServer(conn.db);
    for (const payload of [{}, { title: "  " }, { mode: "hybrid" }, { start: "2026-06-20T09:00:00+09:00" }, { threadId: 2 }]) {
      const r = await app.inject({ method: "PATCH", url: `/api/events/${e}/thread-node`, payload });
      expect(r.statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PATCH", url: "/api/events/0/thread-node", payload: { title: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/events/9999/thread-node", payload: { title: "x" } })).statusCode).toBe(404);
  });

  it("rejects a GCal-imported event with 409 and leaves the row unchanged", async () => {
    const conn = makeTestDb();
    const e = insertEvent(conn, insertThread(conn, "A"), { source: "gcal", title: "외부" });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: `/api/events/${e}/thread-node`, payload: { title: "바꿔" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EXTERNAL_EVENT_READ_ONLY");
    expect(col(conn, "events", e, "title")).toBe("외부");
  });
});

describe("PATCH /api/tasks/:id/thread-node", () => {
  it("updates only allowed fields and leaves status/threadId unchanged", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "A");
    const task = insertTask(conn, t);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${task}/thread-node`, payload: { title: "새 작업", estMinutes: 45, due: null, optional: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.task.title).toBe("새 작업");
    expect(res.json().data.task.estMinutes).toBe(45);
    expect(res.json().data.task.due).toBeNull();
    expect(res.json().data.task.optional).toBe(1);
    expect(col(conn, "tasks", task, "status")).toBe("todo");
    expect(col(conn, "tasks", task, "thread_id")).toBe(t);
  });

  it("rejects empty patch, blank title, bad due, unknown id", async () => {
    const conn = makeTestDb();
    const task = insertTask(conn, insertThread(conn, "A"));
    const app = buildServer(conn.db);
    for (const payload of [{}, { title: " " }, { due: "2026-13-01" }, { status: "done" }]) {
      expect((await app.inject({ method: "PATCH", url: `/api/tasks/${task}/thread-node`, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PATCH", url: "/api/tasks/9999/thread-node", payload: { title: "x" } })).statusCode).toBe(404);
  });
});

describe("GET /api/threads/:id nodeLinks + PATCH confirm", () => {
  it("returns node links only when both endpoints are in the thread", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    const e1 = insertEvent(conn, t1, { title: "발표" });
    const tk1 = insertTask(conn, t1, "슬라이드");
    const e2 = insertEvent(conn, t2, { title: "외부" });
    insertLink(conn, "event", e1, "task", tk1); // both in t1
    insertLink(conn, "event", e1, "event", e2); // cross-thread → excluded
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t1}` })).json().data;
    expect(detail.nodeLinks).toHaveLength(1);
    expect(detail.nodeLinks[0].from).toEqual({ kind: "event", id: e1, title: "발표" });
    expect(detail.nodeLinks[0].to).toEqual({ kind: "task", id: tk1, title: "슬라이드" });
  });

  it("confirm promotes soft/inferred to hard/authored and does not touch unrelated rows", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const e1 = insertEvent(conn, t1);
    const tk1 = insertTask(conn, t1);
    const link = insertLink(conn, "event", e1, "task", tk1, { firmness: "soft", source: "given" });
    const other = insertLink(conn, "task", tk1, "event", e1, { firmness: "tentative", source: "inferred" });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: `/api/threads/${t1}/node-links/${link}/confirm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reused).toBe(false);
    expect(res.json().data.link).toMatchObject({ firmness: "hard", source: "authored" });
    expect(col(conn, "links", link, "firmness")).toBe("hard");
    expect(col(conn, "links", link, "source")).toBe("authored");
    // unrelated link untouched
    expect(col(conn, "links", other, "firmness")).toBe("tentative");
  });

  it("confirm is idempotent for an already hard/authored link (reused=true, no rewrite)", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const e1 = insertEvent(conn, t1);
    const tk1 = insertTask(conn, t1);
    const link = insertLink(conn, "event", e1, "task", tk1, { firmness: "hard", source: "authored" });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: `/api/threads/${t1}/node-links/${link}/confirm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reused).toBe(true);
    expect(col(conn, "links", link, "firmness")).toBe("hard");
  });

  it("confirm rejects cross-thread links, missing endpoints, and unknown links with 404", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    const e1 = insertEvent(conn, t1);
    const e2 = insertEvent(conn, t2);
    const crossLink = insertLink(conn, "event", e1, "event", e2); // endpoints in different threads
    const missingEndpoint = insertLink(conn, "event", e1, "task", 9999); // task 9999 doesn't exist
    const app = buildServer(conn.db);
    expect((await app.inject({ method: "PATCH", url: `/api/threads/${t1}/node-links/${crossLink}/confirm` })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/api/threads/${t1}/node-links/${missingEndpoint}/confirm` })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/api/threads/${t1}/node-links/9999/confirm` })).statusCode).toBe(404);
    // invariant: cross-thread link never promoted to hard
    expect(col(conn, "links", crossLink, "firmness")).toBe("soft");
  });
});
