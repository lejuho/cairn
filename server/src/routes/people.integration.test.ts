import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-people-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertEvent(conn: SqliteConnection, title: string): number {
  conn.sqlite
    .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES (?, '2026-06-20T10:00:00+09:00', '2026-06-20T11:00:00+09:00', 'cairn', 1, 'planned')")
    .run(title);
  const row = conn.sqlite.prepare("SELECT id FROM events WHERE title = ? ORDER BY id DESC LIMIT 1").get(title) as { id: number };
  return row.id;
}

function insertPerson(conn: SqliteConnection, name: string, channel = "none"): number {
  conn.sqlite.prepare("INSERT INTO people (name, channel) VALUES (?, ?)").run(name, channel);
  const row = conn.sqlite.prepare("SELECT id FROM people WHERE name = ? ORDER BY id DESC LIMIT 1").get(name) as { id: number };
  return row.id;
}

// ── GET /api/people ───────────────────────────────────────────────────────────

describe("GET /api/people", () => {
  it("returns empty list when no people", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/people" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("returns people sorted by name ascending", async () => {
    const conn = makeTestDb();
    insertPerson(conn, "Charlie", "email");
    insertPerson(conn, "Alice", "kakao");
    insertPerson(conn, "Bob", "sms");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/people" });
    const body = JSON.parse(res.body);
    expect(body.data.map((p: { name: string }) => p.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });
});

// ── POST /api/people ──────────────────────────────────────────────────────────

describe("POST /api/people", () => {
  it("creates a person and returns it", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/people",
      payload: { displayName: "  다나  ", channel: "kakao", relation: "  동료  " }
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.person.name).toBe("다나");
    expect(body.data.person.relation).toBe("동료");
    expect(body.data.person.channel).toBe("kakao");
  });

  it("rejects empty display name", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/people",
      payload: { displayName: "", channel: "none" }
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid channel", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/people",
      payload: { displayName: "테스트", channel: "discord" }
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("trims relation field", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/people",
      payload: { displayName: "이름", channel: "sms", relation: "  친구  " }
    });
    expect(JSON.parse(res.body).data.person.relation).toBe("친구");
  });

  it("stores blank relation as null, not empty string", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/people",
      payload: { displayName: "이름", channel: "none", relation: "   " }
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.person.relation).toBeNull();
  });
});

// ── GET /api/events/:id/people ────────────────────────────────────────────────

describe("GET /api/events/:id/people", () => {
  it("returns event and empty people list", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "회의");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}/people` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.event.id).toBe(eventId);
    expect(body.data.people).toEqual([]);
  });

  it("returns attached people", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "점심");
    const personId = insertPerson(conn, "민지");
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, personId);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}/people` });
    const body = JSON.parse(res.body);
    expect(body.data.people).toHaveLength(1);
    expect(body.data.people[0].name).toBe("민지");
  });

  it("returns 404 for unknown event", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/events/999/people" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid id", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/events/abc/people" });
    expect(res.statusCode).toBe(400);
  });
});

// ── PUT /api/events/:id/people ────────────────────────────────────────────────

describe("PUT /api/events/:id/people", () => {
  it("attaches people to event", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "팀 회의");
    const p1 = insertPerson(conn, "주원");
    const p2 = insertPerson(conn, "서아");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/events/${eventId}/people`,
      payload: { personIds: [p1, p2] }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.people).toHaveLength(2);
    const names = body.data.people.map((p: { name: string }) => p.name);
    expect(names).toContain("주원");
    expect(names).toContain("서아");
  });

  it("detaches all when personIds is empty", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "내 일정");
    const personId = insertPerson(conn, "연우");
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, personId);
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/events/${eventId}/people`,
      payload: { personIds: [] }
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.people).toEqual([]);
  });

  it("de-dupes duplicate personIds", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "중복 테스트");
    const personId = insertPerson(conn, "시온");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/events/${eventId}/people`,
      payload: { personIds: [personId, personId, personId] }
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.people).toHaveLength(1);
  });

  it("replaces existing attachment transactionally", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "교체 테스트");
    const p1 = insertPerson(conn, "도윤");
    const p2 = insertPerson(conn, "하린");
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, p1);
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/events/${eventId}/people`,
      payload: { personIds: [p2] }
    });
    const body = JSON.parse(res.body);
    expect(body.data.people).toHaveLength(1);
    expect(body.data.people[0].name).toBe("하린");
  });

  it("returns 404 when event not found", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: "/api/events/999/people",
      payload: { personIds: [] }
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when a personId does not exist", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "없는 사람");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/events/${eventId}/people`,
      payload: { personIds: [9999] }
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("NOT_FOUND");
  });
});

// ── POST /api/events with personIds ──────────────────────────────────────────

describe("POST /api/events with personIds", () => {
  it("creates event without personIds (existing behavior)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/events",
      payload: { title: "테스트", start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00" }
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it("creates event and attaches people when personIds provided", async () => {
    const conn = makeTestDb();
    const p1 = insertPerson(conn, "현우");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/events",
      payload: { title: "미팅", start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00", personIds: [p1] }
    });
    expect(res.statusCode).toBe(201);
    const eventId = JSON.parse(res.body).data.id;
    const check = conn.sqlite.prepare("SELECT COUNT(*) as cnt FROM event_people WHERE event_id = ?").get(eventId) as { cnt: number };
    expect(check.cnt).toBe(1);
  });

  it("rejects event creation when personId does not exist", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/events",
      payload: { title: "테스트", start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00", personIds: [8888] }
    });
    expect(res.statusCode).toBe(404);
  });

  it("no event row is created when personIds validation fails (atomic)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    await app.inject({
      method: "POST", url: "/api/events",
      payload: { title: "롤백 테스트", start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T11:00:00+09:00", personIds: [7777] }
    });
    const row = conn.sqlite.prepare("SELECT COUNT(*) as cnt FROM events WHERE title = ?").get("롤백 테스트") as { cnt: number };
    expect(row.cnt).toBe(0);
  });
});

