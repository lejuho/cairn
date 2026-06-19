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

// ── GET /api/people — hardConstraints ─────────────────────────────────────────

describe("GET /api/people — hardConstraints field", () => {
  it("returns empty hardConstraints array when column is null", async () => {
    const conn = makeTestDb();
    insertPerson(conn, "NoPerson");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/people" });
    expect(res.json().data[0].hardConstraints).toEqual([]);
  });

  it("returns parsed hardConstraints from stored JSON", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "ConstrainedPerson");
    conn.sqlite.prepare("UPDATE people SET hard_constraints = ? WHERE id = ?")
      .run(JSON.stringify([{ type: "weekday_unavailable", weekday: "monday", text: "월요일 불가", firmness: "hard" }]), pid);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/people" });
    const person = res.json().data[0];
    expect(person.hardConstraints).toHaveLength(1);
    expect(person.hardConstraints[0].weekday).toBe("monday");
    expect(person.hardConstraints[0].firmness).toBe("hard");
  });

  it("silently drops malformed constraint entries from hardConstraints", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "MalformedPerson");
    conn.sqlite.prepare("UPDATE people SET hard_constraints = ? WHERE id = ?")
      .run(JSON.stringify([
        { type: "weekday_unavailable", weekday: "tuesday", firmness: "hard" }, // missing text
        { type: "weekday_unavailable", weekday: "wednesday", text: "수요일", firmness: "hard" }  // valid
      ]), pid);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/people" });
    const person = res.json().data[0];
    expect(person.hardConstraints).toHaveLength(1);
    expect(person.hardConstraints[0].weekday).toBe("wednesday");
  });
});

// ── PUT /api/people/:id/hard-constraints ─────────────────────────────────────

describe("PUT /api/people/:id/hard-constraints", () => {
  it("saves weekday constraints and returns normalized person", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "SavePerson");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/people/${pid}/hard-constraints`,
      payload: { unavailableWeekdays: ["monday", "wednesday"] }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.person.hardConstraints).toHaveLength(2);
    const weekdays = body.data.person.hardConstraints.map((c: { weekday: string }) => c.weekday).sort();
    expect(weekdays).toEqual(["monday", "wednesday"]);
  });

  it("de-duplicates weekdays", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "DupePerson");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/people/${pid}/hard-constraints`,
      payload: { unavailableWeekdays: ["friday", "friday", "saturday"] }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.person.hardConstraints).toHaveLength(2);
  });

  it("empty array clears all constraints", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "ClearPerson");
    conn.sqlite.prepare("UPDATE people SET hard_constraints = ? WHERE id = ?")
      .run(JSON.stringify([{ type: "weekday_unavailable", weekday: "monday", text: "t", firmness: "hard" }]), pid);
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/people/${pid}/hard-constraints`,
      payload: { unavailableWeekdays: [] }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.person.hardConstraints).toHaveLength(0);
  });

  it("returns 404 for unknown person id", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: "/api/people/9999/hard-constraints",
      payload: { unavailableWeekdays: ["monday"] }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid weekday value", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "ValidatePerson");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/people/${pid}/hard-constraints`,
      payload: { unavailableWeekdays: ["funday"] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("persists and reloads via GET /api/people", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "RoundtripPerson");
    const app = buildServer(conn.db);
    await app.inject({
      method: "PUT", url: `/api/people/${pid}/hard-constraints`,
      payload: { unavailableWeekdays: ["thursday"] }
    });
    const getRes = await app.inject({ method: "GET", url: "/api/people" });
    const person = getRes.json().data.find((p: { id: number }) => p.id === pid);
    expect(person.hardConstraints[0].weekday).toBe("thursday");
    expect(person.hardConstraints[0].firmness).toBe("hard");
  });
});

// ── GET /api/people/directory ─────────────────────────────────────────────────

const NOW_DIR = "2026-06-20T09:00:00+09:00";

function insertPastMeeting(conn: SqliteConnection, personId: number, end: string, status = "done"): void {
  conn.sqlite.prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('past', '2026-01-01T10:00:00+09:00', ?, 'cairn', 1, ?)").run(end, status);
  const ev = conn.sqlite.prepare("SELECT id FROM events ORDER BY id DESC LIMIT 1").get() as { id: number };
  conn.sqlite.prepare("INSERT OR IGNORE INTO event_people (event_id, person_id) VALUES (?, ?)").run(ev.id, personId);
}

describe("GET /api/people/directory", () => {
  it("requires now query param — 400 on missing", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/people/directory" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns empty list when no people", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.people).toEqual([]);
  });

  it("each person appears once with all directory fields", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "Alice", "kakao");
    conn.sqlite.prepare("UPDATE people SET hard_constraints = ? WHERE id = ?")
      .run(JSON.stringify([{ type: "weekday_unavailable", weekday: "monday", text: "monday 불가", firmness: "hard" }]), pid);
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const people = res.json().data.people;
    expect(people).toHaveLength(1);
    const p = people[0];
    expect(p.id).toBe(pid);
    expect(p.name).toBe("Alice");
    expect(p.channel).toBe("kakao");
    expect(p.totalMeets).toBe(0);
    expect(p.lastMet).toBeNull();
    expect(p.frequencyBand).toBe("cold_start");
    expect(p.hardConstraints[0].weekday).toBe("monday");
  });

  it("qualifying done/confirmed events counted; planned/cancelled/moved/late excluded", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "TestPerson");
    insertPastMeeting(conn, pid, "2026-05-01T11:00:00+09:00", "done");
    insertPastMeeting(conn, pid, "2026-05-02T11:00:00+09:00", "confirmed");
    insertPastMeeting(conn, pid, "2026-05-03T11:00:00+09:00", "planned");     // excluded
    insertPastMeeting(conn, pid, "2026-05-04T11:00:00+09:00", "cancelled");   // excluded
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const p = res.json().data.people[0];
    expect(p.totalMeets).toBe(2);
  });

  it("moved/late events are excluded from qualifying meets", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "MovedLatePerson");
    insertPastMeeting(conn, pid, "2026-05-01T11:00:00+09:00", "done");   // counted
    insertPastMeeting(conn, pid, "2026-05-02T11:00:00+09:00", "moved");  // excluded
    insertPastMeeting(conn, pid, "2026-05-03T11:00:00+09:00", "late");   // excluded
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const p = res.json().data.people[0];
    expect(p.totalMeets).toBe(1);
    expect(p.lastMet).toBe("2026-05-01T11:00:00+09:00");
  });

  it("future done events (end after now) are excluded", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "FuturePerson");
    insertPastMeeting(conn, pid, "2026-05-01T11:00:00+09:00", "done");   // past — counted
    insertPastMeeting(conn, pid, "2026-12-31T11:00:00+09:00", "done");   // future relative to NOW_DIR — excluded
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const p = res.json().data.people[0];
    expect(p.totalMeets).toBe(1);
    expect(p.lastMet).toBe("2026-05-01T11:00:00+09:00");
  });

  it("malformed/null event end timestamps never become relationship evidence", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "MalformedMeetPerson");
    insertPastMeeting(conn, pid, "2026-05-01T11:00:00+09:00", "done");   // valid — counted
    insertPastMeeting(conn, pid, "not-a-date", "done");                  // malformed — excluded
    // null end
    conn.sqlite.prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('nullend', '2026-01-01T10:00:00+09:00', NULL, 'cairn', 1, 'done')").run();
    const evNull = conn.sqlite.prepare("SELECT id FROM events ORDER BY id DESC LIMIT 1").get() as { id: number };
    conn.sqlite.prepare("INSERT OR IGNORE INTO event_people (event_id, person_id) VALUES (?, ?)").run(evNull.id, pid);
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const p = res.json().data.people[0];
    expect(p.totalMeets).toBe(1);
    expect(p.lastMet).toBe("2026-05-01T11:00:00+09:00");
  });

  it("mixed RFC3339 offsets compared by epoch — +09:00 event past Z now is counted", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "MixedPerson");
    // now = "2026-06-20T00:30:00Z"; event end = "2026-06-20T09:00:00+09:00" = "2026-06-20T00:00Z" — past by epoch
    const nowZ = "2026-06-20T00:30:00Z";
    insertPastMeeting(conn, pid, "2026-06-20T09:00:00+09:00", "done");
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(nowZ)}` });
    const p = res.json().data.people[0];
    expect(p.totalMeets).toBe(1);
  });

  it("lastMet is epoch-latest (not lexically latest)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "LastMetPerson");
    // epoch-later: "2026-05-09T20:00:00Z" vs lexically-later: "2026-05-10T01:00:00+09:00" = "2026-05-09T16:00Z"
    insertPastMeeting(conn, pid, "2026-05-09T20:00:00Z", "done");    // epoch-latest
    insertPastMeeting(conn, pid, "2026-05-10T01:00:00+09:00", "done"); // lexically larger
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const p = res.json().data.people[0];
    expect(p.lastMet).toBe("2026-05-09T20:00:00Z");
  });

  it("directory sort: lastMet desc, null last, then name asc, id asc", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pA = insertPerson(conn, "Alice");    // null lastMet
    const pB = insertPerson(conn, "Bob");      // older lastMet
    const pC = insertPerson(conn, "Charlie");  // newer lastMet
    insertPastMeeting(conn, pB, "2026-04-01T11:00:00+09:00", "done");
    insertPastMeeting(conn, pC, "2026-05-01T11:00:00+09:00", "done");
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const ids = res.json().data.people.map((p: { id: number }) => p.id);
    expect(ids).toEqual([pC, pB, pA]);
  });

  it("tied lastMet: name asc, then id asc as tiebreak", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pZ = insertPerson(conn, "Zebra");
    const pA = insertPerson(conn, "Aaron");
    const SAME_END = "2026-05-01T11:00:00+09:00";
    insertPastMeeting(conn, pZ, SAME_END, "done");
    insertPastMeeting(conn, pA, SAME_END, "done");
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const names = res.json().data.people.map((p: { name: string }) => p.name);
    expect(names).toEqual(["Aaron", "Zebra"]);
  });

  it("frequency bands: 0→cold_start, 1→rare, 3→established, 8→frequent", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    insertPerson(conn, "Cold");
    const pRare = insertPerson(conn, "Rare");
    const pEst = insertPerson(conn, "Est");
    const pFreq = insertPerson(conn, "Freq");
    insertPastMeeting(conn, pRare, "2026-05-01T11:00:00+09:00", "done");
    for (let i = 0; i < 3; i++) insertPastMeeting(conn, pEst, `2026-0${i + 2}-01T11:00:00+09:00`, "done");
    for (let i = 0; i < 8; i++) insertPastMeeting(conn, pFreq, `2025-0${i + 1}-01T11:00:00+09:00`, "done");
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW_DIR)}` });
    const byName = Object.fromEntries(res.json().data.people.map((p: { name: string; frequencyBand: string }) => [p.name, p.frequencyBand]));
    expect(byName["Cold"]).toBe("cold_start");
    expect(byName["Rare"]).toBe("rare");
    expect(byName["Est"]).toBe("established");
    expect(byName["Freq"]).toBe("frequent");
  });
});

// ── GET /api/people/:id/detail ────────────────────────────────────────────────

describe("GET /api/people/:id/detail", () => {
  it("400 on invalid id", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/people/abc/detail?now=${encodeURIComponent(NOW_DIR)}` });
    expect(res.statusCode).toBe(400);
  });

  it("400 on missing now", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "Alice");
    const res = await app.inject({ method: "GET", url: `/api/people/${pid}/detail` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("404 on unknown person id", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/people/9999/detail?now=${encodeURIComponent(NOW_DIR)}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns person with stats and empty recentMeetings when no qualifying events", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "Alice", "kakao");
    const res = await app.inject({ method: "GET", url: `/api/people/${pid}/detail?now=${encodeURIComponent(NOW_DIR)}` });
    expect(res.statusCode).toBe(200);
    const { person, recentMeetings } = res.json().data;
    expect(person.id).toBe(pid);
    expect(person.totalMeets).toBe(0);
    expect(person.frequencyBand).toBe("cold_start");
    expect(recentMeetings).toEqual([]);
  });

  it("recentMeetings contains only qualifying linked events, newest-ended first", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "DetailPerson");
    insertPastMeeting(conn, pid, "2026-05-01T11:00:00+09:00", "done");   // older
    insertPastMeeting(conn, pid, "2026-05-20T11:00:00+09:00", "done");   // newer
    insertPastMeeting(conn, pid, "2026-05-10T11:00:00+09:00", "planned"); // excluded
    const res = await app.inject({ method: "GET", url: `/api/people/${pid}/detail?now=${encodeURIComponent(NOW_DIR)}` });
    const { recentMeetings } = res.json().data;
    expect(recentMeetings).toHaveLength(2);
    // newest first
    expect(recentMeetings[0].end).toBe("2026-05-20T11:00:00+09:00");
    expect(recentMeetings[1].end).toBe("2026-05-01T11:00:00+09:00");
  });

  it("recentMeetings limited to 10", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "ManyMeets");
    for (let i = 1; i <= 12; i++) {
      insertPastMeeting(conn, pid, `2025-${String(i).padStart(2, "0")}-01T11:00:00+09:00`, "done");
    }
    const res = await app.inject({ method: "GET", url: `/api/people/${pid}/detail?now=${encodeURIComponent(NOW_DIR)}` });
    expect(res.json().data.recentMeetings).toHaveLength(10);
  });

  it("recentMeetings epoch-sorted: +09:00 event sorted correctly against Z events", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "SortPerson");
    // "2026-05-10T01:00:00+09:00" = May 9 16:00Z; "2026-05-09T20:00:00Z" = May 9 20:00Z (later)
    insertPastMeeting(conn, pid, "2026-05-10T01:00:00+09:00", "done");
    insertPastMeeting(conn, pid, "2026-05-09T20:00:00Z", "done");
    const res = await app.inject({ method: "GET", url: `/api/people/${pid}/detail?now=${encodeURIComponent(NOW_DIR)}` });
    const ends = res.json().data.recentMeetings.map((e: { end: string }) => e.end);
    // "2026-05-09T20:00:00Z" is epoch-later → should be first
    expect(ends[0]).toBe("2026-05-09T20:00:00Z");
  });

  it("recentMeetings equal-end tie-break is event id ascending", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const pid = insertPerson(conn, "TiePerson");
    const SAME_END = "2026-05-01T11:00:00+09:00";
    // Insert three qualifying events that share the exact same end instant.
    insertPastMeeting(conn, pid, SAME_END, "done");
    insertPastMeeting(conn, pid, SAME_END, "done");
    insertPastMeeting(conn, pid, SAME_END, "done");
    const res = await app.inject({ method: "GET", url: `/api/people/${pid}/detail?now=${encodeURIComponent(NOW_DIR)}` });
    const ids = res.json().data.recentMeetings.map((e: { id: number }) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("existing GET /api/people does not regress", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    insertPerson(conn, "Reg1");
    const res = await app.inject({ method: "GET", url: "/api/people" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });
});

