import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-events-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertEvent(conn: SqliteConnection, title: string, threadId?: number): number {
  conn.sqlite
    .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES (?, '2026-06-20T10:00:00+09:00', '2026-06-20T11:00:00+09:00', 'cairn', 1, 'planned', ?)")
    .run(title, threadId ?? null);
  const row = conn.sqlite.prepare("SELECT id FROM events WHERE title = ? ORDER BY id DESC LIMIT 1").get(title) as { id: number };
  return row.id;
}

function insertThread(conn: SqliteConnection, name: string): number {
  conn.sqlite.prepare("INSERT INTO threads (name) VALUES (?)").run(name);
  const row = conn.sqlite.prepare("SELECT id FROM threads WHERE name = ? ORDER BY id DESC LIMIT 1").get(name) as { id: number };
  return row.id;
}

function insertPerson(conn: SqliteConnection, name: string): number {
  conn.sqlite.prepare("INSERT INTO people (name, channel) VALUES (?, 'none')").run(name);
  const row = conn.sqlite.prepare("SELECT id FROM people WHERE name = ? ORDER BY id DESC LIMIT 1").get(name) as { id: number };
  return row.id;
}

function insertAnnotation(conn: SqliteConnection, eventId: number, reasonText: string): void {
  conn.sqlite.prepare("INSERT INTO annotations (event_id, reason_text) VALUES (?, ?)").run(eventId, reasonText);
}

// ── GET /api/events/:id ───────────────────────────────────────────────────────

describe("GET /api/events/:id", () => {
  it("returns event detail with empty people and annotations", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "회의");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.event.id).toBe(eventId);
    expect(body.data.people).toEqual([]);
    expect(body.data.annotations).toEqual([]);
    expect(body.data.thread).toBeNull();
  });

  it("returns attached people and annotations", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "팀 회의");
    const personId = insertPerson(conn, "지수");
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, personId);
    insertAnnotation(conn, eventId, "첫 번째 메모");
    insertAnnotation(conn, eventId, "두 번째 메모");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}` });
    const body = JSON.parse(res.body);
    expect(body.data.people).toHaveLength(1);
    expect(body.data.people[0].name).toBe("지수");
    expect(body.data.annotations).toHaveLength(2);
    expect(body.data.annotations[0].reasonText).toBe("두 번째 메모");
  });

  it("returns attached people sorted by name then id", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "정렬 테스트");
    // Insert in non-sorted order; ids ascend with insertion (charlie=1, alice=2, bob=3).
    const charlie = insertPerson(conn, "charlie");
    const alice = insertPerson(conn, "alice");
    const bob = insertPerson(conn, "bob");
    for (const pid of [charlie, alice, bob]) {
      conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, pid);
    }
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}` });
    const body = JSON.parse(res.body);
    expect(body.data.people.map((p: { name: string }) => p.name)).toEqual(["alice", "bob", "charlie"]);
  });

  it("returns compact thread when event has threadId", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "프로젝트 A");
    const eventId = insertEvent(conn, "킥오프", threadId);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}` });
    const body = JSON.parse(res.body);
    expect(body.data.thread).toEqual({ id: threadId, name: "프로젝트 A" });
  });

  it("returns null thread when event has no threadId", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "독립 이벤트");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}` });
    const body = JSON.parse(res.body);
    expect(body.data.thread).toBeNull();
  });

  it("returns annotations newest first", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "순서 테스트");
    insertAnnotation(conn, eventId, "첫째");
    insertAnnotation(conn, eventId, "둘째");
    insertAnnotation(conn, eventId, "셋째");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}` });
    const body = JSON.parse(res.body);
    const texts = body.data.annotations.map((a: { reasonText: string }) => a.reasonText);
    expect(texts).toEqual(["셋째", "둘째", "첫째"]);
  });

  it("returns 404 for unknown event", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/events/9999" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for non-integer id", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/events/abc" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
  });
});

// ── PATCH /api/events/:id/status ──────────────────────────────────────────────

describe("PATCH /api/events/:id/status", () => {
  it("updates event status and returns updated event", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "상태 변경 테스트");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${eventId}/status`,
      payload: { status: "done" }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.event.status).toBe("done");
    expect(body.data.event.id).toBe(eventId);
  });

  it("accepts all valid outcome statuses", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    for (const status of ["planned", "confirmed", "done", "cancelled", "moved", "late"] as const) {
      const eventId = insertEvent(conn, `이벤트-${status}`);
      const res = await app.inject({
        method: "PATCH", url: `/api/events/${eventId}/status`,
        payload: { status }
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.event.status).toBe(status);
    }
  });

  it("rejects uppercase status", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "대문자 테스트");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${eventId}/status`,
      payload: { status: "DONE" }
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown status", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "알 수 없는 상태");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${eventId}/status`,
      payload: { status: "deleted" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for unknown event", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: "/api/events/9999/status",
      payload: { status: "done" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("works without LLM gateway (deterministic only)", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "LLM 없이 테스트");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${eventId}/status`,
      payload: { status: "cancelled" }
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.event.status).toBe("cancelled");
  });
});
