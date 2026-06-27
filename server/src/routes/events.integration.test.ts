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

// ── POST /api/events/:id/preparations (manual entry, cycle-46 FR-BRF-04) ─────────

describe("POST /api/events/:id/preparations", () => {
  const rowCounts = (conn: SqliteConnection) => ({
    r: (conn.sqlite.prepare("SELECT count(*) c FROM resources").get() as { c: number }).c,
    rl: (conn.sqlite.prepare("SELECT count(*) c FROM resource_links").get() as { c: number }).c
  });

  it("creates one item resource and one direct event link (201)", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "노트북" } });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.resource).toMatchObject({ name: "노트북", kind: "item", sourcePersonId: null });
    expect(body.data.link).toMatchObject({ targetType: "event", targetId: eventId, firmness: "hard", reason: "직접 추가" });
    expect(body.data.reusedResource).toBe(false);
    expect(body.data.reusedLink).toBe(false);
    expect(rowCounts(conn)).toEqual({ r: 1, rl: 1 });
  });

  it("trims the submitted name", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "  충전기  " } });
    expect(JSON.parse(res.body).data.resource.name).toBe("충전기");
  });

  it("reuses an existing item resource by exact name+kind (no duplicate resource)", async () => {
    const conn = makeTestDb();
    const e1 = insertEvent(conn, "발표 A");
    const e2 = insertEvent(conn, "발표 B");
    const app = buildServer(conn.db);
    await app.inject({ method: "POST", url: `/api/events/${e1}/preparations`, payload: { name: "노트북" } });
    const res = await app.inject({ method: "POST", url: `/api/events/${e2}/preparations`, payload: { name: "노트북" } });
    expect(res.statusCode).toBe(201); // new link for e2
    expect(JSON.parse(res.body).data.reusedResource).toBe(true);
    expect(rowCounts(conn)).toEqual({ r: 1, rl: 2 }); // one resource, two links
  });

  it("repeat POST for the same event is idempotent (200, reusedLink) and does not duplicate", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    const app = buildServer(conn.db);
    await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "노트북" } });
    const res = await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "노트북" } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.reusedLink).toBe(true);
    expect(rowCounts(conn)).toEqual({ r: 1, rl: 1 });
  });

  it("does not rewrite an existing tentative link to hard on duplicate submit", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    // pre-existing tentative link from a prior suggestion
    conn.sqlite.prepare("INSERT INTO resources (name, kind) VALUES ('노트북', 'item')").run();
    const rid = (conn.sqlite.prepare("SELECT id FROM resources WHERE name='노트북'").get() as { id: number }).id;
    conn.sqlite.prepare("INSERT INTO resource_links (resource_id, target_type, target_id, firmness, reason) VALUES (?, 'event', ?, 'tentative', 'suggested')").run(rid, eventId);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "노트북" } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.reusedLink).toBe(true);
    expect(body.data.link.firmness).toBe("tentative"); // not promoted
    expect(body.data.link.reason).toBe("suggested");
    const link = conn.sqlite.prepare("SELECT firmness, reason FROM resource_links WHERE resource_id=? AND target_id=?").get(rid, eventId) as { firmness: string; reason: string };
    expect(link.firmness).toBe("tentative");
  });

  it("a name matching a knowledge resource creates a NEW item resource (no conversion)", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    conn.sqlite.prepare("INSERT INTO resources (name, kind) VALUES ('슬라이드', 'knowledge')").run();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "슬라이드" } });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.resource.kind).toBe("item");
    expect(rowCounts(conn).r).toBe(2); // knowledge + new item
  });

  it("rejects blank-after-trim body and writes nothing (400)", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    const app = buildServer(conn.db);
    const before = rowCounts(conn);
    const res = await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "   " } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
    expect(rowCounts(conn)).toEqual(before);
  });

  it("returns 404 for missing event and writes nothing", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const before = rowCounts(conn);
    const res = await app.inject({ method: "POST", url: "/api/events/9999/preparations", payload: { name: "노트북" } });
    expect(res.statusCode).toBe(404);
    expect(rowCounts(conn)).toEqual(before);
  });

  it("GET detail after POST includes the new preparation with scope event_direct", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    const app = buildServer(conn.db);
    await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "노트북" } });
    const detail = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${eventId}` })).body);
    const prep = detail.data.scheduleBrief.preparations.find((p: { resource: { name: string } }) => p.resource.name === "노트북");
    expect(prep).toBeDefined();
    expect(prep.links[0]).toMatchObject({ scope: "event_direct", firmness: "hard", reason: "직접 추가" });
  });
});

// ── preparation suggestions (cycle-47 FR-BRF-04) ────────────────────────────────

describe("GET /api/events/:id — preparationSuggestions", () => {
  it("returns the three fixed suggestions for a presentation-keyword event", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표 리허설");
    const app = buildServer(conn.db);
    const brief = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${eventId}` })).body).data.scheduleBrief;
    expect(brief.preparationSuggestions.map((s: { name: string }) => s.name)).toEqual(["노트북", "충전기", "어댑터"]);
    expect(brief.preparationSuggestions[0]).toMatchObject({ kind: "item", source: "deterministic_keyword", reasonCode: "presentation_keyword" });
    expect(brief.reasonCodes).toContain("brief_preparation_suggestions");
  });

  it("returns no suggestions for a non-matching event", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "점심 약속");
    const app = buildServer(conn.db);
    const brief = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${eventId}` })).body).data.scheduleBrief;
    expect(brief.preparationSuggestions).toEqual([]);
    expect(brief.reasonCodes).not.toContain("brief_preparation_suggestions");
  });

  it("triggers on thread name keyword", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "데모 준비");
    const eventId = insertEvent(conn, "회의", threadId);
    const app = buildServer(conn.db);
    const brief = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${eventId}` })).body).data.scheduleBrief;
    expect(brief.preparationSuggestions).toHaveLength(3);
    expect(brief.preparationSuggestions[0].evidence).toEqual({ field: "thread_name", value: "데모 준비" });
  });

  it("GET with suggestions leaves resource/resource_links/events/annotations row counts unchanged", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    const counts = () => ({
      r: (conn.sqlite.prepare("SELECT count(*) c FROM resources").get() as { c: number }).c,
      rl: (conn.sqlite.prepare("SELECT count(*) c FROM resource_links").get() as { c: number }).c,
      e: (conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number }).c,
      an: (conn.sqlite.prepare("SELECT count(*) c FROM annotations").get() as { c: number }).c
    });
    const before = counts();
    const app = buildServer(conn.db);
    const brief = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${eventId}` })).body).data.scheduleBrief;
    expect(brief.preparationSuggestions).toHaveLength(3); // proves the suggestion path ran
    expect(counts()).toEqual(before);
  });

  it("after accepting a suggestion, it no longer appears and is in preparations", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "발표");
    const app = buildServer(conn.db);
    await app.inject({ method: "POST", url: `/api/events/${eventId}/preparations`, payload: { name: "노트북" } });
    const brief = JSON.parse((await app.inject({ method: "GET", url: `/api/events/${eventId}` })).body).data.scheduleBrief;
    expect(brief.preparationSuggestions.map((s: { name: string }) => s.name)).toEqual(["충전기", "어댑터"]); // 노트북 suppressed
    expect(brief.preparations.some((p: { resource: { name: string } }) => p.resource.name === "노트북")).toBe(true);
  });
});

// ── PATCH /api/events/:id/schedule-prompt/dismiss (cycle-61 FR-SLOT-06B) ──────

function insertUnscheduled(
  conn: SqliteConnection,
  title: string,
  opts: { source?: string; selfImposed?: number; status?: string; start?: string | null; end?: string | null } = {}
): number {
  const { source = "cairn", selfImposed = 1, status = "planned", start = null, end = null } = opts;
  conn.sqlite
    .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run(title, start, end, source, selfImposed, status);
  return (conn.sqlite.prepare("SELECT id FROM events WHERE title = ? ORDER BY id DESC LIMIT 1").get(title) as { id: number }).id;
}

const TODAY = "2026-06-27";
const NEXT_DAY = "2026-06-28";
const NOW = "2026-06-27T10:00:00+09:00";

function unscheduledIdsOnToday(body: { data: { unscheduledEvents: Array<{ id: number }> } }): number[] {
  return body.data.unscheduledEvents.map((e) => e.id);
}

describe("PATCH /api/events/:id/schedule-prompt/dismiss", () => {
  it("migration adds the schedule_prompt_dismissed_on column (nullable, no rebuild)", () => {
    const conn = makeTestDb();
    const cols = conn.sqlite.prepare("pragma table_info(events)").all() as Array<{ name: string; notnull: number }>;
    const col = cols.find((c) => c.name === "schedule_prompt_dismissed_on");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0);
    // legacy-style row reads back NULL
    const id = insertUnscheduled(conn, "레거시");
    const row = conn.sqlite.prepare("SELECT schedule_prompt_dismissed_on AS d FROM events WHERE id = ?").get(id) as { d: string | null };
    expect(row.d).toBeNull();
  });

  it("hides an eligible prompt for the dismissed date and lets it reappear the next date", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const id = insertUnscheduled(conn, "산책");

    // appears before dismiss
    const before = JSON.parse((await app.inject({ method: "GET", url: `/api/today?date=${TODAY}&now=${encodeURIComponent(NOW)}` })).body);
    expect(unscheduledIdsOnToday(before)).toContain(id);

    const res = await app.inject({ method: "PATCH", url: `/api/events/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, data: { eventId: id, dismissedOn: TODAY } });

    // gone for TODAY
    const after = JSON.parse((await app.inject({ method: "GET", url: `/api/today?date=${TODAY}&now=${encodeURIComponent(NOW)}` })).body);
    expect(unscheduledIdsOnToday(after)).not.toContain(id);

    // reappears for NEXT_DAY (no background job)
    const next = JSON.parse((await app.inject({ method: "GET", url: `/api/today?date=${NEXT_DAY}&now=${encodeURIComponent("2026-06-28T10:00:00+09:00")}` })).body);
    expect(unscheduledIdsOnToday(next)).toContain(id);
  });

  it("is idempotent for the same event/date", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const id = insertUnscheduled(conn, "재시도");
    const first = await app.inject({ method: "PATCH", url: `/api/events/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
    const second = await app.inject({ method: "PATCH", url: `/api/events/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).data).toEqual({ eventId: id, dismissedOn: TODAY });
  });

  it("mutates only schedule_prompt_dismissed_on + updated_at", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const id = insertUnscheduled(conn, "범위확인");
    const beforeRow = conn.sqlite.prepare("SELECT start, end, status, source, self_imposed AS si, thread_id AS tid FROM events WHERE id = ?").get(id);

    await app.inject({ method: "PATCH", url: `/api/events/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });

    const afterRow = conn.sqlite.prepare("SELECT start, end, status, source, self_imposed AS si, thread_id AS tid, schedule_prompt_dismissed_on AS d, updated_at AS u FROM events WHERE id = ?").get(id) as Record<string, unknown>;
    expect({ start: afterRow.start, end: afterRow.end, status: afterRow.status, source: afterRow.source, si: afterRow.si, tid: afterRow.tid }).toEqual(beforeRow);
    expect(afterRow.d).toBe(TODAY);
    expect(afterRow.u).not.toBeNull();
  });

  it("returns 404 for an unknown event", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: `/api/events/9999/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 SCHEDULE_PROMPT_NOT_ELIGIBLE for scheduled/external/cancelled/non-self-imposed events and does not write", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const cases = [
      insertUnscheduled(conn, "이미잡힘", { start: "2026-06-27T09:00:00+09:00", end: "2026-06-27T10:00:00+09:00" }),
      insertUnscheduled(conn, "외부", { source: "gcal", selfImposed: 0 }),
      insertUnscheduled(conn, "취소됨", { status: "cancelled" }),
      insertUnscheduled(conn, "비자발", { selfImposed: 0 })
    ];
    for (const id of cases) {
      const res = await app.inject({ method: "PATCH", url: `/api/events/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe("SCHEDULE_PROMPT_NOT_ELIGIBLE");
      const d = conn.sqlite.prepare("SELECT schedule_prompt_dismissed_on AS d FROM events WHERE id = ?").get(id) as { d: string | null };
      expect(d.d).toBeNull(); // no write
    }
  });

  it("returns 400 for a bad id or invalid body", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const id = insertUnscheduled(conn, "검증");
    expect((await app.inject({ method: "PATCH", url: `/api/events/abc/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/events/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: "2026-13-40" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/events/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY, taskId: 5 } })).statusCode).toBe(400);
  });

  it("changes no table row counts; only the target event fields change", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const id = insertUnscheduled(conn, "카운트");
    const counts = () => {
      const tables = ["events", "tasks", "threads", "watchers", "annotations", "params"];
      return Object.fromEntries(tables.map((t) => [t, (conn.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n]));
    };
    const before = counts();
    await app.inject({ method: "PATCH", url: `/api/events/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
    expect(counts()).toEqual(before);
  });
});
