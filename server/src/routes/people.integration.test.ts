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

  it("event-people GET includes normalized profile fields (ISSUE-3)", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "프로필체크-GET");
    const id = insertPerson(conn, "프로필체크A");
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, id);
    const app = buildServer(conn.db);
    // Set a profile on the person first.
    await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { preferredWeekdays: ["monday"], preferredPeriods: ["morning"], leadTimeDays: 7, channel: "kakao", unavailableWeekdays: ["friday"] }
    });
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}/people` });
    expect(res.statusCode).toBe(200);
    const person = res.json().data.people[0];
    expect(person.preferredWindows?.weekdays).toEqual(["monday"]);
    expect(person.leadTime?.days).toBe(7);
    expect(person.hardConstraints?.[0]?.weekday).toBe("friday");
  });

  it("event-people PUT includes normalized profile fields (ISSUE-3)", async () => {
    const conn = makeTestDb();
    const eventId = insertEvent(conn, "프로필체크-PUT");
    const id = insertPerson(conn, "프로필체크B");
    const app = buildServer(conn.db);
    await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { preferredWeekdays: ["wednesday"], preferredPeriods: ["evening"], leadTimeDays: 3, channel: "sms", unavailableWeekdays: [] }
    });
    const res = await app.inject({
      method: "PUT", url: `/api/events/${eventId}/people`,
      payload: { personIds: [id] }
    });
    expect(res.statusCode).toBe(200);
    const person = res.json().data.people[0];
    expect(person.preferredWindows?.weekdays).toEqual(["wednesday"]);
    expect(person.leadTime?.days).toBe(3);
    expect(person.channel).toBe("sms");
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

// ── PUT /api/people/:id/profile ───────────────────────────────────────────────

describe("PUT /api/people/:id/profile", () => {
  const base = {
    preferredWeekdays: ["monday", "wednesday"],
    preferredPeriods: ["evening"],
    leadTimeDays: 3,
    channel: "kakao",
    unavailableWeekdays: ["friday"]
  };

  it("updates and reads back all authored fields", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필A");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PUT", url: `/api/people/${id}/profile`, payload: base });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const person = body.data.person;
    expect(person.preferredWindows?.weekdays).toEqual(["monday", "wednesday"]);
    expect(person.preferredWindows?.periods).toEqual(["evening"]);
    expect(person.preferredWindows?.firmness).toBe("hard");
    expect(person.leadTime?.days).toBe(3);
    expect(person.leadTime?.firmness).toBe("hard");
    expect(person.channel).toBe("kakao");
    expect(person.hardConstraints).toEqual([
      { type: "weekday_unavailable", weekday: "friday", text: "friday 불가", firmness: "hard" }
    ]);
  });

  it("normalizes duplicate weekdays and preserves canonical order", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필B");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: {
        ...base,
        preferredWeekdays: ["wednesday", "monday", "monday"],
        unavailableWeekdays: ["friday", "friday", "saturday"]
      }
    });
    expect(res.statusCode).toBe(200);
    const person = res.json().data.person;
    expect(person.preferredWindows?.weekdays).toEqual(["monday", "wednesday"]);
    expect(person.hardConstraints?.map((c: { weekday: string }) => c.weekday)).toEqual(["friday", "saturday"]);
  });

  it("persists leadTimeDays=0 (same-day) and reads back 0", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필C");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PUT", url: `/api/people/${id}/profile`, payload: { ...base, leadTimeDays: 0 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.person.leadTime?.days).toBe(0);
  });

  it("clears preferred windows and lead time when both arrays empty and null", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필D");
    const app = buildServer(conn.db);
    // Set first
    await app.inject({ method: "PUT", url: `/api/people/${id}/profile`, payload: base });
    // Then clear
    const res = await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { ...base, preferredWeekdays: [], preferredPeriods: [], leadTimeDays: null, unavailableWeekdays: [] }
    });
    expect(res.statusCode).toBe(200);
    const person = res.json().data.person;
    expect(person.preferredWindows).toBeNull();
    expect(person.leadTime).toBeNull();
    expect(person.hardConstraints).toEqual([]);
  });

  it("rejects non-positive integer id", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PUT", url: "/api/people/0/profile", payload: base });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for unknown person", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PUT", url: "/api/people/9999/profile", payload: base });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects invalid body (bad channel)", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필E");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PUT", url: `/api/people/${id}/profile`, payload: { ...base, channel: "discord" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects contradictory weekdays (preferred ∩ unavailable ≠ ∅)", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필F");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { ...base, preferredWeekdays: ["monday"], unavailableWeekdays: ["monday"] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects half-empty windows (weekdays present but periods absent)", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필G");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { ...base, preferredWeekdays: ["monday"], preferredPeriods: [] }
    });
    expect(res.statusCode).toBe(400);
  });

  it("makes no partial writes on rejected input", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필H");
    const app = buildServer(conn.db);
    // Set a known-good profile first
    await app.inject({ method: "PUT", url: `/api/people/${id}/profile`, payload: base });
    // Try to write contradictory — must fail
    await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { ...base, preferredWeekdays: ["monday"], unavailableWeekdays: ["monday"] }
    });
    // Read back via GET detail — person should still have prior good values
    const now = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/people/${id}/detail?now=${encodeURIComponent(now)}` });
    const person = res.json().data.person;
    expect(person.preferredWindows?.weekdays).toContain("monday");
    expect(person.preferredWindows?.weekdays).toContain("wednesday");
  });

  it("fails open when stored preferred_windows JSON is malformed", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필I");
    // Inject malformed JSON directly
    conn.sqlite.prepare("UPDATE people SET preferred_windows = ? WHERE id = ?").run("not-valid-json", id);
    const app = buildServer(conn.db);
    const now = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/people/${id}/detail?now=${encodeURIComponent(now)}` });
    expect(res.statusCode).toBe(200);
    const person = res.json().data.person;
    expect(person.preferredWindows).toBeNull();
    expect(person.name).toBe("프로필I");
  });

  it("fails open when stored lead_time JSON is malformed", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필J");
    conn.sqlite.prepare("UPDATE people SET lead_time = ? WHERE id = ?").run("{invalid}", id);
    const app = buildServer(conn.db);
    const now = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/people/${id}/detail?now=${encodeURIComponent(now)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.person.leadTime).toBeNull();
  });

  it("directory rows include normalized profile fields", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필K");
    const app = buildServer(conn.db);
    await app.inject({ method: "PUT", url: `/api/people/${id}/profile`, payload: base });
    const now = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(now)}` });
    const person = res.json().data.people.find((p: { id: number }) => p.id === id);
    expect(person.preferredWindows?.weekdays).toEqual(["monday", "wednesday"]);
    expect(person.leadTime?.days).toBe(3);
  });

  it("list endpoint includes normalized profile fields", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필L");
    const app = buildServer(conn.db);
    await app.inject({ method: "PUT", url: `/api/people/${id}/profile`, payload: base });
    const res = await app.inject({ method: "GET", url: "/api/people" });
    const person = res.json().data.find((p: { id: number }) => p.id === id);
    expect(person.preferredWindows?.weekdays).toEqual(["monday", "wednesday"]);
    expect(person.leadTime?.days).toBe(3);
  });

  it("existing hard-constraint route still works after profile route added", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "프로필M");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT", url: `/api/people/${id}/hard-constraints`,
      payload: { unavailableWeekdays: ["tuesday"] }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.person.hardConstraints).toEqual([
      { type: "weekday_unavailable", weekday: "tuesday", text: "tuesday 불가", firmness: "hard" }
    ]);
  });
});

// ── PUT /api/people/:id/hard-constraints — profile invariant guard (ISSUE-2) ──

describe("PUT /api/people/:id/hard-constraints — profile invariant", () => {
  it("rejects unavailable day that overlaps existing preferred windows", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "제약충돌A");
    const app = buildServer(conn.db);
    // Set preferred windows first
    await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { preferredWeekdays: ["monday", "wednesday"], preferredPeriods: ["evening"], leadTimeDays: null, channel: "none", unavailableWeekdays: [] }
    });
    // Now try to mark monday as unavailable via legacy route — must be rejected
    const res = await app.inject({
      method: "PUT", url: `/api/people/${id}/hard-constraints`,
      payload: { unavailableWeekdays: ["monday"] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("leaves existing row unchanged when legacy route rejects overlap", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "제약충돌B");
    const app = buildServer(conn.db);
    await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { preferredWeekdays: ["monday"], preferredPeriods: ["morning"], leadTimeDays: null, channel: "none", unavailableWeekdays: [] }
    });
    // Rejected PUT
    await app.inject({
      method: "PUT", url: `/api/people/${id}/hard-constraints`,
      payload: { unavailableWeekdays: ["monday"] }
    });
    // Person should still have empty hardConstraints
    const now = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/people/${id}/detail?now=${encodeURIComponent(now)}` });
    const person = res.json().data.person;
    expect(person.hardConstraints).toEqual([]);
    expect(person.preferredWindows?.weekdays).toContain("monday");
  });

  it("allows non-overlapping unavailable days even when preferred windows exist", async () => {
    const conn = makeTestDb();
    const id = insertPerson(conn, "제약충돌C");
    const app = buildServer(conn.db);
    await app.inject({
      method: "PUT", url: `/api/people/${id}/profile`,
      payload: { preferredWeekdays: ["monday"], preferredPeriods: ["morning"], leadTimeDays: null, channel: "none", unavailableWeekdays: [] }
    });
    const res = await app.inject({
      method: "PUT", url: `/api/people/${id}/hard-constraints`,
      payload: { unavailableWeekdays: ["tuesday"] }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.person.hardConstraints[0].weekday).toBe("tuesday");
  });
});


describe("people — groups and editing basics", () => {
  it("stores groups apart from the description, lists them by use, and edits what was written at first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-people-groups-"));
    const conn = createSqliteConnection(join(dir, "test.sqlite3"));
    runMigrations(conn);
    const app = buildServer(conn.db);
    try {
      const add = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/people", payload });
      const a = (await add({ displayName: "구예모", relation: "학회장", channel: "kakao", groups: ["BAY", " BAY ", "운영진"] })).json().data.person;
      await add({ displayName: "이재근", channel: "kakao", groups: ["BAY"] });
      await add({ displayName: "왕지우", relation: "10년지기 친구", channel: "none" });
      expect(a.groups).toEqual(["BAY", "운영진"]);

      expect((await app.inject({ method: "GET", url: "/api/people/groups" })).json().data.groups).toEqual([{ name: "BAY", count: 2 }, { name: "운영진", count: 1 }]);

      const patched = await app.inject({ method: "PATCH", url: `/api/people/${a.id}`, payload: { name: "구예모 형", relation: "BAY 학회장, 25년에 처음 만남", groups: ["BAY"] } });
      expect(patched.json().data.person).toEqual(expect.objectContaining({ name: "구예모 형", relation: "BAY 학회장, 25년에 처음 만남", groups: ["BAY"], channel: "kakao" }));
      // 바꾸지 않은 것은 그대로 두고, 설명은 비울 수 있다.
      expect((await app.inject({ method: "PATCH", url: `/api/people/${a.id}`, payload: { relation: null } })).json().data.person).toEqual(expect.objectContaining({ name: "구예모 형", relation: null, groups: ["BAY"] }));
      // 성별은 정하지 않은 채로 시작하고, 정하거나 다시 비울 수 있다.
      expect(a.gender).toBeNull();
      expect((await app.inject({ method: "PATCH", url: `/api/people/${a.id}`, payload: { gender: "male" } })).json().data.person.gender).toBe("male");
      expect((await app.inject({ method: "PATCH", url: `/api/people/${a.id}`, payload: { gender: null } })).json().data.person.gender).toBeNull();
      expect((await app.inject({ method: "PATCH", url: `/api/people/${a.id}`, payload: { gender: "other" } })).statusCode).toBe(400);
      expect((await add({ displayName: "배예림", channel: "kakao", gender: "female" })).json().data.person.gender).toBe("female");
      expect((await app.inject({ method: "PATCH", url: `/api/people/${a.id}`, payload: {} })).statusCode).toBe(400);
      expect((await app.inject({ method: "PATCH", url: "/api/people/9999", payload: { name: "없음" } })).statusCode).toBe(404);

      const directory = (await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent("2026-11-15T00:00:00.000Z")}` })).json().data.people;
      expect(directory.find((p: { name: string }) => p.name === "이재근").groups).toEqual(["BAY"]);
      expect(directory.find((p: { name: string }) => p.name === "왕지우").groups).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("people — notes and event attendees", () => {
  it("keeps notes on a person, finds people as note targets, and lets the agent set who an event is with", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-people-notes-"));
    const conn = createSqliteConnection(join(dir, "test.sqlite3"));
    runMigrations(conn);
    const replies: object[] = [
      { say: "사람을 찾아볼게요.", actions: [{ tool: "list_people", args: { q: "구예모" } }], done: false },
      {
        say: "구예모 님과의 회의를 만들고 메모를 남겼습니다.",
        actions: [
          { tool: "create_event", args: { title: "BAY 운영 회의", start: "2099-03-12T19:00:00+09:00", end: "2099-03-12T20:00:00+09:00", personIds: [1] } },
          { tool: "create_note", args: { body: "회의 때 예산안 가져오기로 함", links: [{ targetType: "person", targetId: 1 }] } },
          { tool: "set_event_people", args: { eventId: 1, personIds: [1, 2] } }
        ],
        done: true
      }
    ];
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: async () => JSON.stringify(replies.shift()), mail: null, sheets: null, reason: null } });
    try {
      await app.inject({ method: "POST", url: "/api/people", payload: { displayName: "구예모", channel: "kakao", groups: ["BAY"] } });
      await app.inject({ method: "POST", url: "/api/people", payload: { displayName: "이재근", channel: "kakao", groups: ["BAY"] } });

      const data = (await app.inject({ method: "POST", url: "/api/agent/chat", payload: { provider: "anthropic", text: "구예모랑 3월 12일 7시에 BAY 운영 회의 잡고, 예산안 가져오기로 한 거 적어줘", includePrivate: true } })).json().data;
      expect(data.message.steps.map((s: { tool: string; ok: boolean; summary: string }) => [s.tool, s.ok, s.summary])).toEqual([
        ["create_event", true, "일정 생성: BAY 운영 회의 (2099-03-12 19:00)"],
        ["create_note", true, "메모 저장: 회의 때 예산안 가져오기로 함"],
        ["set_event_people", true, "참석자 지정: BAY 운영 회의 — 구예모, 이재근"]
      ]);
      expect((await app.inject({ method: "GET", url: "/api/events/1/people" })).json().data.people.map((p: { name: string }) => p.name).sort()).toEqual(["구예모", "이재근"]);

      // 그 사람에게 붙은 메모만 모아 볼 수 있고, 메모에는 사람 이름이 대상으로 실린다.
      const notes = (await app.inject({ method: "GET", url: "/api/notes?targetType=person&targetId=1" })).json().data.notes;
      expect(notes).toEqual([expect.objectContaining({ body: "회의 때 예산안 가져오기로 함", links: [{ targetType: "person", targetId: 1, label: "구예모", when: null, status: null, exists: true }] })]);
      expect((await app.inject({ method: "GET", url: "/api/notes?targetType=person&targetId=2" })).json().data.notes).toEqual([]);
      // 붙일 곳을 찾을 때 사람도 나온다. 없는 사람에게는 붙일 수 없다.
      expect((await app.inject({ method: "GET", url: `/api/notes/targets?q=${encodeURIComponent("이재근")}` })).json().data.targets).toEqual([expect.objectContaining({ targetType: "person", targetId: 2, label: "이재근" })]);
      expect((await app.inject({ method: "POST", url: "/api/notes", payload: { body: "x", links: [{ targetType: "person", targetId: 99 }] } })).statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("people — who is near, and pinning", () => {
  it("attaches the nearest upcoming and latest recent event to each person, and remembers pins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-people-near-"));
    const conn = createSqliteConnection(join(dir, "test.sqlite3"));
    runMigrations(conn);
    const app = buildServer(conn.db);
    try {
      const NOW = "2026-11-15T03:00:00.000Z";
      for (const name of ["가", "나", "다"]) await app.inject({ method: "POST", url: "/api/people", payload: { displayName: name, channel: "none" } });
      const event = async (title: string, start: string, personIds: number[], status?: string) => {
        const end = new Date(Date.parse(start) + 3_600_000).toISOString();
        const made = await app.inject({ method: "POST", url: "/api/events", payload: { title, start, end, personIds } });
        if (made.statusCode !== 201) throw new Error(made.body);
        const id = made.json().data.id as number;
        if (status) await app.inject({ method: "PATCH", url: `/api/events/${id}/status`, payload: { status } });
      };
      await event("곧 있을 회의", "2026-11-19T20:30:00+09:00", [1]);
      await event("더 나중 회의", "2026-11-28T10:00:00+09:00", [1]);
      await event("지난 모임", "2026-11-10T19:00:00+09:00", [1, 2]);
      await event("오래전 모임", "2026-09-01T19:00:00+09:00", [3]);
      await event("취소된 약속", "2026-11-20T19:00:00+09:00", [3], "cancelled");

      await app.inject({ method: "PATCH", url: "/api/people/3", payload: { pinned: true } });
      const people = (await app.inject({ method: "GET", url: `/api/people/directory?now=${encodeURIComponent(NOW)}` })).json().data.people as Array<Record<string, unknown>>;
      const of = (name: string) => people.find((p) => p.name === name)!;
      expect(of("가")).toEqual(expect.objectContaining({ upcoming: expect.objectContaining({ title: "곧 있을 회의" }), recent: expect.objectContaining({ title: "지난 모임" }), pinned: false }));
      expect(of("나")).toEqual(expect.objectContaining({ upcoming: null, recent: expect.objectContaining({ title: "지난 모임" }) }));
      // 30일 밖의 일정과 취소된 일정은 치지 않는다.
      expect(of("다")).toEqual(expect.objectContaining({ upcoming: null, recent: null, pinned: true }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("people — deleting", () => {
  it("deletes a person nothing points at, and asks first when events or notes still do", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-people-delete-"));
    const conn = createSqliteConnection(join(dir, "test.sqlite3"));
    runMigrations(conn);
    const app = buildServer(conn.db);
    try {
      for (const name of ["중복", "쓰는 사람"]) await app.inject({ method: "POST", url: "/api/people", payload: { displayName: name, channel: "none" } });
      await app.inject({ method: "POST", url: "/api/events", payload: { title: "회의", start: "2099-03-12T19:00:00+09:00", end: "2099-03-12T20:00:00+09:00", personIds: [2] } });
      await app.inject({ method: "POST", url: "/api/notes", payload: { body: "기억할 것", links: [{ targetType: "person", targetId: 2 }] } });

      expect((await app.inject({ method: "DELETE", url: "/api/people/1" })).json()).toEqual({ ok: true, data: { deleted: 1, usage: { events: 0, notes: 0, resources: 0 } } });
      expect((await app.inject({ method: "DELETE", url: "/api/people/1" })).statusCode).toBe(404);

      const blocked = await app.inject({ method: "DELETE", url: "/api/people/2" });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().data.usage).toEqual({ events: 1, notes: 1, resources: 0 });
      expect((await app.inject({ method: "DELETE", url: "/api/people/2", headers: { "x-cairn-audience": "remote" } })).statusCode).toBe(403);

      // 확인하고 지우면 연결만 끊기고 일정과 메모는 남는다.
      expect((await app.inject({ method: "DELETE", url: "/api/people/2?force=1" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/people" })).json().data).toEqual([]);
      expect((await app.inject({ method: "GET", url: "/api/events/1/people" })).json().data.people).toEqual([]);
      const note = (await app.inject({ method: "GET", url: "/api/notes/1" })).json().data.note;
      expect(note).toEqual(expect.objectContaining({ body: "기억할 것", links: [] }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
