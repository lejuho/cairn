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

// ── event mode (Schedule Brief A, FR-BRF) ───────────────────────────────────────

const VALID_BODY = {
  title: "모드 테스트",
  start: "2026-06-20T09:00:00+09:00",
  end: "2026-06-20T10:00:00+09:00"
};

describe("POST /api/events — mode", () => {
  it("persists a valid mode", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "POST", url: "/api/events", payload: { ...VALID_BODY, mode: "remote" } });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.mode).toBe("remote");
    const row = conn.sqlite.prepare("SELECT mode FROM events ORDER BY id DESC LIMIT 1").get() as { mode: string | null };
    expect(row.mode).toBe("remote");
  });

  it("defaults mode to null when omitted (backward compatible)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "POST", url: "/api/events", payload: VALID_BODY });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.mode).toBeNull();
  });

  it("rejects invalid mode and writes nothing", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const before = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const res = await app.inject({ method: "POST", url: "/api/events", payload: { ...VALID_BODY, mode: "hybrid" } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
    const after = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it("SQLite CHECK rejects an out-of-enum mode written directly", async () => {
    const conn = makeTestDb();
    expect(() =>
      conn.sqlite.prepare("INSERT INTO events (title, mode, source, self_imposed, status) VALUES ('x', 'bogus', 'cairn', 1, 'planned')").run()
    ).toThrow();
  });

  it("SQLite accepts a legacy event with mode = null", async () => {
    const conn = makeTestDb();
    expect(() =>
      conn.sqlite.prepare("INSERT INTO events (title, source, self_imposed, status) VALUES ('legacy', 'cairn', 1, 'planned')").run()
    ).not.toThrow();
    const row = conn.sqlite.prepare("SELECT mode FROM events WHERE title = 'legacy'").get() as { mode: string | null };
    expect(row.mode).toBeNull();
  });
});

describe("GET /api/events/:id — scheduleBrief", () => {
  it("returns a quiet brief for an event with no thread/people/prior context", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "독립 이벤트");
    const app = buildServer(conn.db);
    const body = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${eventId}` })).body);
    expect(body.data.scheduleBrief).toBeDefined();
    expect(body.data.scheduleBrief.mode).toBeNull();
    expect(body.data.scheduleBrief.thread).toBeNull();
    expect(body.data.scheduleBrief.previousEvent).toBeNull();
    expect(body.data.scheduleBrief.people).toEqual([]);
    expect(body.data.scheduleBrief.reasonCodes).toEqual([]);
  });

  it("surfaces thread, prior same-thread event + its annotation, and people facts", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "발표 준비");
    // prior same-thread event ended 2026-06-19T10:00 (before target start 06-20T09:00)
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES ('리허설', '2026-06-19T09:00:00+09:00', '2026-06-19T10:00:00+09:00', 'cairn', 1, 'planned', ?)")
      .run(threadId);
    const priorId = (conn.sqlite.prepare("SELECT id FROM events WHERE title='리허설'").get() as { id: number }).id;
    insertAnnotation(conn, priorId, "리허설 메모");
    // target event
    const targetId = insertEvent(conn, "본 발표", threadId);
    const personId = insertPerson(conn, "Alice");
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(targetId, personId);
    conn.sqlite.prepare("UPDATE people SET lead_time = ? WHERE id = ?").run(JSON.stringify({ days: 3, firmness: "hard" }), personId);

    const app = buildServer(conn.db);
    const body = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${targetId}` })).body);
    const brief = body.data.scheduleBrief;
    expect(brief.thread).toMatchObject({ id: threadId, name: "발표 준비" });
    expect(brief.previousEvent).toMatchObject({ id: priorId, title: "리허설" });
    expect(brief.previousAnnotation.reasonText).toBe("리허설 메모");
    expect(brief.people).toHaveLength(1);
    expect(brief.people[0]).toMatchObject({ name: "Alice", leadTimeDays: 3 });
    expect(brief.reasonCodes).toContain("brief_thread_present");
    expect(brief.reasonCodes).toContain("brief_previous_event");
    expect(brief.reasonCodes).toContain("brief_previous_annotation");
    expect(brief.reasonCodes).toContain("brief_people_present");
  });

  it("ignores later same-thread events as previous context", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "T");
    const targetId = insertEvent(conn, "타깃", threadId); // start 06-20T10:00
    // a LATER same-thread event (ends after target start) must not be picked
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES ('미래', '2026-06-21T09:00:00+09:00', '2026-06-21T10:00:00+09:00', 'cairn', 1, 'planned', ?)")
      .run(threadId);
    const app = buildServer(conn.db);
    const body = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${targetId}` })).body);
    expect(body.data.scheduleBrief.previousEvent).toBeNull();
  });

  it("GET detail does not change event/annotation row counts (read-only)", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "T");
    const eventId = insertEvent(conn, "E", threadId);
    insertAnnotation(conn, eventId, "메모");
    const evBefore = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const anBefore = conn.sqlite.prepare("SELECT count(*) c FROM annotations").get() as { c: number };
    const app = buildServer(conn.db);
    await app.inject({ method: "GET", url: `/api/events/${eventId}` });
    const evAfter = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const anAfter = conn.sqlite.prepare("SELECT count(*) c FROM annotations").get() as { c: number };
    expect(evAfter.c).toBe(evBefore.c);
    expect(anAfter.c).toBe(anBefore.c);
  });
});

// ── preparation brief (cycle-45 FR-BRF-04) ──────────────────────────────────────

function insertResource(conn: SqliteConnection, name: string, kind: "item" | "knowledge", sourcePersonId: number | null = null): number {
  const r = conn.sqlite
    .prepare("INSERT INTO resources (name, kind, source_person_id) VALUES (?, ?, ?)")
    .run(name, kind, sourcePersonId);
  return Number(r.lastInsertRowid);
}

function insertResourceLink(conn: SqliteConnection, resourceId: number, targetType: "event" | "task" | "thread", targetId: number, firmness = "soft", reason: string | null = null): void {
  conn.sqlite
    .prepare("INSERT INTO resource_links (resource_id, target_type, target_id, firmness, reason) VALUES (?, ?, ?, ?, ?)")
    .run(resourceId, targetType, targetId, firmness, reason);
}

function getBrief(conn: SqliteConnection, eventId: number) {
  const app = buildServer(conn.db);
  return app.inject({ method: "GET", url: `/api/events/${eventId}` }).then((r) => JSON.parse(r.body).data.scheduleBrief);
}

describe("GET /api/events/:id — preparations", () => {
  it("returns empty preparations when no resources are linked", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "독립");
    const brief = await getBrief(conn, eventId);
    expect(brief.preparations).toEqual([]);
    expect(brief.reasonCodes).not.toContain("brief_preparations");
  });

  it("direct event resource link appears with scope event_direct", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    const rid = insertResource(conn, "노트북", "item");
    insertResourceLink(conn, rid, "event", eventId, "hard", "발표용");
    const brief = await getBrief(conn, eventId);
    expect(brief.preparations).toHaveLength(1);
    expect(brief.preparations[0].resource.name).toBe("노트북");
    expect(brief.preparations[0].links[0]).toMatchObject({ scope: "event_direct", firmness: "hard", reason: "발표용" });
    expect(brief.reasonCodes).toContain("brief_preparations");
  });

  it("thread-level resource link appears with scope thread_context", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "발표 준비");
    const eventId = insertEvent(conn, "발표", threadId);
    const rid = insertResource(conn, "슬라이드", "knowledge");
    insertResourceLink(conn, rid, "thread", threadId, "soft");
    const brief = await getBrief(conn, eventId);
    expect(brief.preparations).toHaveLength(1);
    expect(brief.preparations[0].links[0].scope).toBe("thread_context");
  });

  it("prior same-thread event resource link appears with scope previous_event", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "발표 준비");
    // prior event ended before target start (target start = 06-20T10:00)
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES ('리허설', '2026-06-19T09:00:00+09:00', '2026-06-19T10:00:00+09:00', 'cairn', 1, 'planned', ?)")
      .run(threadId);
    const priorId = (conn.sqlite.prepare("SELECT id FROM events WHERE title='리허설'").get() as { id: number }).id;
    const eventId = insertEvent(conn, "본 발표", threadId);
    const rid = insertResource(conn, "발표 노트", "knowledge");
    insertResourceLink(conn, rid, "event", priorId, "soft");
    const brief = await getBrief(conn, eventId);
    const prep = brief.preparations.find((p: { resource: { name: string } }) => p.resource.name === "발표 노트");
    expect(prep.links[0].scope).toBe("previous_event");
  });

  it("a resource linked to both event and thread is grouped once with two scoped links", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "T");
    const eventId = insertEvent(conn, "발표", threadId);
    const rid = insertResource(conn, "노트북", "item");
    insertResourceLink(conn, rid, "event", eventId, "hard");
    insertResourceLink(conn, rid, "thread", threadId, "soft");
    const brief = await getBrief(conn, eventId);
    expect(brief.preparations).toHaveLength(1);
    expect(brief.preparations[0].links.map((l: { scope: string }) => l.scope)).toEqual(["event_direct", "thread_context"]);
  });

  it("includes source person name when resource has a source person", async () => {
    const conn = makeTestDb();
    const personId = insertPerson(conn, "Alice");
    const eventId = insertEvent(conn, "발표");
    const rid = insertResource(conn, "노트북", "item", personId);
    insertResourceLink(conn, rid, "event", eventId, "soft");
    const brief = await getBrief(conn, eventId);
    expect(brief.preparations[0].sourcePerson).toMatchObject({ name: "Alice" });
  });

  it("GET detail does not change events/annotations/resources/resource_links/people/params row counts", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "T");
    const eventId = insertEvent(conn, "발표", threadId);
    const rid = insertResource(conn, "노트북", "item");
    insertResourceLink(conn, rid, "event", eventId, "soft");
    // Seed a params row so the read-only assertion proves params is untouched.
    conn.sqlite.prepare("INSERT OR REPLACE INTO params (key, value) VALUES ('energy_budget', '8')").run();
    const counts = () => ({
      events: (conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number }).c,
      annotations: (conn.sqlite.prepare("SELECT count(*) c FROM annotations").get() as { c: number }).c,
      r: (conn.sqlite.prepare("SELECT count(*) c FROM resources").get() as { c: number }).c,
      rl: (conn.sqlite.prepare("SELECT count(*) c FROM resource_links").get() as { c: number }).c,
      p: (conn.sqlite.prepare("SELECT count(*) c FROM people").get() as { c: number }).c,
      params: (conn.sqlite.prepare("SELECT count(*) c FROM params").get() as { c: number }).c
    });
    const before = counts();
    const app = buildServer(conn.db);
    await app.inject({ method: "GET", url: `/api/events/${eventId}` });
    expect(counts()).toEqual(before);
  });
});
