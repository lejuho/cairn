import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-slots-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const NOW = "2026-06-20T08:00:00+09:00";
const DATE = "2026-06-20";

function insertUnscheduled(conn: SqliteConnection, title: string): number {
  conn.sqlite
    .prepare("INSERT INTO events (title, source, self_imposed, status) VALUES (?, 'cairn', 1, 'planned')")
    .run(title);
  const row = conn.sqlite.prepare("SELECT id FROM events WHERE title = ? ORDER BY id DESC LIMIT 1").get(title) as { id: number };
  return row.id;
}

function insertScheduled(conn: SqliteConnection, title: string, start: string, end: string, source = "cairn", selfImposed = 0, status = "planned") {
  conn.sqlite
    .prepare("INSERT INTO events (title, source, self_imposed, status, start, end) VALUES (?, ?, ?, ?, ?, ?)")
    .run(title, source, selfImposed, status, start, end);
}

describe("Today — schedule_prompt cards", () => {
  let conn: ReturnType<typeof makeTestDb>;
  beforeEach(() => { conn = makeTestDb(); });
  afterEach(() => conn.sqlite.close());

  it("unscheduled Cairn planned event appears as schedule_prompt", async () => {
    insertUnscheduled(conn, "독서");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const { data } = res.json();
    expect(data.unscheduledEvents).toHaveLength(1);
    expect(data.unscheduledEvents[0].title).toBe("독서");
    expect(data.cards.some((c: { kind: string }) => c.kind === "schedule_prompt")).toBe(true);
  });

  it("GCal event excluded from schedule prompts", async () => {
    conn.sqlite.prepare("INSERT INTO events (title, source, self_imposed, status) VALUES ('GCal', 'gcal', 0, 'planned')").run();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const { data } = res.json();
    expect(data.unscheduledEvents).toHaveLength(0);
    expect(data.cards.some((c: { kind: string }) => c.kind === "schedule_prompt")).toBe(false);
  });

  it("already-scheduled event excluded from schedule prompts", async () => {
    insertScheduled(conn, "회의", "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00", "cairn", 1);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const { data } = res.json();
    expect(data.unscheduledEvents).toHaveLength(0);
  });

  it("done/cancelled events excluded from schedule prompts", async () => {
    conn.sqlite.prepare("INSERT INTO events (title, source, self_imposed, status) VALUES ('done', 'cairn', 1, 'done')").run();
    conn.sqlite.prepare("INSERT INTO events (title, source, self_imposed, status) VALUES ('cancelled', 'cairn', 1, 'cancelled')").run();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const { data } = res.json();
    expect(data.unscheduledEvents).toHaveLength(0);
  });

  it("schedule prompts limited to 3, oldest id first", async () => {
    for (let i = 1; i <= 5; i++) insertUnscheduled(conn, `task-${i}`);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const { data } = res.json();
    expect(data.unscheduledEvents).toHaveLength(5);
    const prompts = data.cards.filter((c: { kind: string }) => c.kind === "schedule_prompt");
    expect(prompts).toHaveLength(3);
    expect((prompts[0] as { kind: string; event: { title: string } }).event.title).toBe("task-1");
    expect((prompts[2] as { kind: string; event: { title: string } }).event.title).toBe("task-3");
  });
});

describe("GET /api/events/:id/slot-candidates", () => {
  let conn: ReturnType<typeof makeTestDb>;
  beforeEach(() => { conn = makeTestDb(); });
  afterEach(() => conn.sqlite.close());

  it("returns up to 3 candidates for unscheduled event", async () => {
    const id = insertUnscheduled(conn, "조깅");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}&days=1`
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.event.id).toBe(id);
    expect(data.candidates.length).toBeGreaterThan(0);
    expect(data.candidates.length).toBeLessThanOrEqual(3);
  });

  it("candidates all start after now", async () => {
    const id = insertUnscheduled(conn, "운동");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}&days=1`
    });
    const { data } = res.json();
    for (const c of data.candidates as Array<{ start: string }>) {
      expect(c.start > NOW).toBe(true);
    }
  });

  it("candidates skip overlapping events", async () => {
    const id = insertUnscheduled(conn, "미팅");
    // block all 5 windows on DATE
    const windows: [number, number][] = [[9, 10], [11, 12], [14, 15], [16, 17], [19, 20]];
    for (const [s, e] of windows) {
      const sh = String(s).padStart(2, "0");
      const eh = String(e).padStart(2, "0");
      insertScheduled(conn, "blocker", `${DATE}T${sh}:30:00+09:00`, `${DATE}T${eh}:30:00+09:00`, "gcal", 0);
    }
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}&days=1`
    });
    const { data } = res.json();
    expect(data.candidates).toHaveLength(0);
  });

  it("returns empty array when all windows in range are blocked", async () => {
    const id = insertUnscheduled(conn, "조깅2");
    insertScheduled(conn, "block", `${DATE}T00:00:00+09:00`, `${DATE}T23:59:00+09:00`, "gcal", 0, "confirmed");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}&days=1`
    });
    const { data } = res.json();
    expect(data.candidates).toHaveLength(0);
  });

  it("returns 404 for non-existent event", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/9999/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for already-scheduled event", async () => {
    insertScheduled(conn, "scheduled", "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00", "cairn", 1);
    const row = conn.sqlite.prepare("SELECT id FROM events ORDER BY id DESC LIMIT 1").get() as { id: number };
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/events/${row.id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(res.statusCode).toBe(400);
  });

  it("works without LLM gateway", async () => {
    const id = insertUnscheduled(conn, "no-llm");
    const app = buildServer(conn.db); // no gateway arg
    const res = await app.inject({
      method: "GET", url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    expect(res.statusCode).toBe(200);
  });

  it("mixed-offset: UTC blocker overlapping +09:00 candidate is excluded", async () => {
    const id = insertUnscheduled(conn, "mixed-offset");
    // 09:00+09:00 = 00:00Z; block 23:30Z–00:30Z which overlaps 00:00Z–01:00Z
    insertScheduled(conn, "utc-blocker", `${DATE}T23:30:00+00:00`, "2026-06-21T00:30:00+00:00", "gcal", 0);
    const app = buildServer(conn.db);
    const nowUtc = `${DATE}T00:00:00+00:00`; // before 09:00+09:00
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(nowUtc)}&days=1`
    });
    const { data } = res.json();
    // 09:00+09:00 slot should be excluded because UTC blocker overlaps it
    const starts = (data.candidates as Array<{ start: string }>).map((c) => c.start);
    expect(starts.every((s) => !s.includes("T09:00:00+09:00"))).toBe(true);
  });
});

describe("GET /api/events/:id/slot-candidates — enriched fields", () => {
  let conn: ReturnType<typeof makeTestDb>;
  beforeEach(() => { conn = makeTestDb(); });
  afterEach(() => conn.sqlite.close());

  it("candidates include score, rank, scoreLabel, contributions", async () => {
    const id = insertUnscheduled(conn, "enriched");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}&days=1`
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.candidates.length).toBeGreaterThan(0);
    const c = data.candidates[0];
    expect(typeof c.score).toBe("number");
    expect(c.rank).toBe(1);
    expect(typeof c.scoreLabel).toBe("string");
    expect(Array.isArray(c.contributions)).toBe(true);
    expect(c.contributions.length).toBe(4); // availability + feasibility + people + friction
    const lenses = c.contributions.map((ct: { lens: string }) => ct.lens);
    expect(lenses).toContain("availability");
    expect(lenses).toContain("feasibility");
    expect(lenses).toContain("people");
    expect(lenses).toContain("friction");
  });

  it("availability contribution is always positive+observed for returned candidates", async () => {
    const id = insertUnscheduled(conn, "avail-check");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}&days=1`
    });
    const { data } = res.json();
    for (const c of data.candidates) {
      const avail = c.contributions.find((ct: { lens: string }) => ct.lens === "availability");
      expect(avail.impact).toBe("positive");
      expect(avail.confidence).toBe("observed");
    }
  });

  it("attached person with preferred windows changes candidate scoring", async () => {
    const id = insertUnscheduled(conn, "people-pref");
    // Insert a person with preferred tuesday morning
    conn.sqlite.prepare("INSERT INTO people (name, channel) VALUES ('Bob', 'kakao')").run();
    const person = conn.sqlite.prepare("SELECT id FROM people ORDER BY id DESC LIMIT 1").get() as { id: number };
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(id, person.id);
    // Set preferred windows: tuesday morning (stored as JSON in preferred_windows column)
    conn.sqlite.prepare(
      "UPDATE people SET preferred_windows = ? WHERE id = ?"
    ).run(JSON.stringify({ weekdays: ["tuesday"], periods: ["morning"], firmness: "hard" }), person.id);

    const app = buildServer(conn.db);
    const dateStr = "2026-06-23"; // Tuesday
    const nowStr = "2026-06-23T08:00:00+09:00";
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${dateStr}&now=${encodeURIComponent(nowStr)}&days=1`
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.candidates.length).toBeGreaterThan(0);
    // Top candidate should include people preferred window contribution
    const peopleCont = data.candidates[0].contributions.find(
      (c: { lens: string; reasonCodes: string[] }) => c.lens === "people"
    );
    expect(peopleCont.reasonCodes).toContain("person_preferred_window");
  });

  it("person with hard unavailable weekday scores negatively and is never marked preferred", async () => {
    const id = insertUnscheduled(conn, "hard-unavail");
    conn.sqlite.prepare("INSERT INTO people (name, channel) VALUES ('Carol', 'sms')").run();
    const person = conn.sqlite.prepare("SELECT id FROM people ORDER BY id DESC LIMIT 1").get() as { id: number };
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(id, person.id);
    // Set hard unavailable: tuesday (stored as JSON in hard_constraints column)
    conn.sqlite.prepare(
      "UPDATE people SET hard_constraints = ? WHERE id = ?"
    ).run(JSON.stringify([{ type: "weekday_unavailable", weekday: "tuesday", text: "no", firmness: "hard" }]), person.id);

    const app = buildServer(conn.db);
    const dateStr = "2026-06-23"; // Tuesday
    const nowStr = "2026-06-23T08:00:00+09:00";
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${dateStr}&now=${encodeURIComponent(nowStr)}&days=2`
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    // Tuesday candidates should have negative people contribution
    for (const c of data.candidates) {
      const startDay = c.start.slice(0, 10);
      const peopleCont = c.contributions.find((ct: { lens: string }) => ct.lens === "people");
      if (startDay === "2026-06-23") {
        expect(peopleCont.reasonCodes).not.toContain("person_preferred_window");
        expect(peopleCont.impact).toBe("negative");
      }
    }
  });

  it("persisted feasibility params affect candidate scoring", async () => {
    const id = insertUnscheduled(conn, "params-score");
    // Set very tight energy budget (1 unit) via params table
    conn.sqlite.prepare("INSERT OR REPLACE INTO params (key, value) VALUES ('energy_budget', '1')").run();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}&days=3`
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    // With budget=1, adding a 1h candidate event fills budget exactly or exceeds it
    // At least some candidates should reflect feasibility scoring
    expect(data.candidates.length).toBeGreaterThan(0);
    const feasContrib = data.candidates[0].contributions.find(
      (c: { lens: string }) => c.lens === "feasibility"
    );
    expect(feasContrib).toBeDefined();
    expect(["energy_within_budget", "energy_over_budget"]).toContain(feasContrib.reasonCodes[0]);
  });

  it("historical annotations affect friction contribution when sample threshold met", async () => {
    // Insert an event with type=meeting
    conn.sqlite.prepare(
      "INSERT INTO events (title, source, self_imposed, status, type) VALUES (?, 'cairn', 1, 'planned', 'meeting')"
    ).run("friction-test");
    const row = conn.sqlite.prepare("SELECT id FROM events ORDER BY id DESC LIMIT 1").get() as { id: number };
    const id = row.id;

    // Insert 3+ annotations of moved outcome on Tuesdays (2026-06-02, 2026-06-09, 2026-06-16 = Tuesdays)
    const tuesdayDates = ["2026-06-02", "2026-06-09", "2026-06-16"];
    for (const d of tuesdayDates) {
      conn.sqlite.prepare("INSERT INTO events (title, source, self_imposed, status, start, end) VALUES ('hist', 'cairn', 1, 'done', ?, ?)").run(`${d}T09:00:00+09:00`, `${d}T10:00:00+09:00`);
      const histEvent = conn.sqlite.prepare("SELECT id FROM events ORDER BY id DESC LIMIT 1").get() as { id: number };
      conn.sqlite.prepare("INSERT INTO annotations (event_id, outcome) VALUES (?, 'moved')").run(histEvent.id);
    }

    const app = buildServer(conn.db);
    const dateStr = "2026-06-23"; // Tuesday
    const nowStr = "2026-06-23T08:00:00+09:00";
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${dateStr}&now=${encodeURIComponent(nowStr)}&days=1`
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.candidates.length).toBeGreaterThan(0);
    const frictionCont = data.candidates[0].contributions.find(
      (c: { lens: string }) => c.lens === "friction"
    );
    // Should have observed confidence (sample threshold met) with high friction
    expect(frictionCont.confidence).toBe("observed");
    expect(frictionCont.reasonCodes).toContain("friction_high_weekday");
  });

  it("candidate fetch does not write events, params, or annotations", async () => {
    const id = insertUnscheduled(conn, "no-write");
    const app = buildServer(conn.db);

    const eventsBefore = (conn.sqlite.prepare("SELECT COUNT(*) as n FROM events").get() as { n: number }).n;
    const paramsBefore = (conn.sqlite.prepare("SELECT COUNT(*) as n FROM params").get() as { n: number }).n;
    const annBefore = (conn.sqlite.prepare("SELECT COUNT(*) as n FROM annotations").get() as { n: number }).n;

    await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });

    const eventsAfter = (conn.sqlite.prepare("SELECT COUNT(*) as n FROM events").get() as { n: number }).n;
    const paramsAfter = (conn.sqlite.prepare("SELECT COUNT(*) as n FROM params").get() as { n: number }).n;
    const annAfter = (conn.sqlite.prepare("SELECT COUNT(*) as n FROM annotations").get() as { n: number }).n;

    expect(eventsAfter).toBe(eventsBefore);
    expect(paramsAfter).toBe(paramsBefore);
    expect(annAfter).toBe(annBefore);
  });

  it("sorted candidates have score desc and earlier start first for equal scores", async () => {
    const id = insertUnscheduled(conn, "sort-check");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/events/${id}/slot-candidates?date=${DATE}&now=${encodeURIComponent(NOW)}&days=3`
    });
    const { data } = res.json();
    const candidates = data.candidates as Array<{ score: number; start: string; rank: number }>;
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]!.score).toBeGreaterThanOrEqual(candidates[i]!.score);
      expect(candidates[i - 1]!.rank).toBe(i);
    }
  });
});

describe("PATCH /api/events/:id/schedule", () => {
  let conn: ReturnType<typeof makeTestDb>;
  beforeEach(() => { conn = makeTestDb(); });
  afterEach(() => conn.sqlite.close());

  it("updates start and end", async () => {
    const id = insertUnscheduled(conn, "독서");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${id}/schedule`,
      payload: { start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00" }
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.event.start).toBe("2026-06-20T09:00:00+09:00");
    expect(data.event.end).toBe("2026-06-20T10:00:00+09:00");
  });

  it("rejects conflicting selection with 409", async () => {
    const id = insertUnscheduled(conn, "조깅");
    insertScheduled(conn, "other", "2026-06-20T09:30:00+09:00", "2026-06-20T10:30:00+09:00", "cairn", 0);
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${id}/schedule`,
      payload: { start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("rejects already-scheduled event with 409", async () => {
    insertScheduled(conn, "alr", "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00", "cairn", 1);
    const row = conn.sqlite.prepare("SELECT id FROM events ORDER BY id DESC LIMIT 1").get() as { id: number };
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${row.id}/schedule`,
      payload: { start: "2026-06-20T14:00:00+09:00", end: "2026-06-20T15:00:00+09:00" }
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects end before start with 400", async () => {
    const id = insertUnscheduled(conn, "미팅");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${id}/schedule`,
      payload: { start: "2026-06-20T11:00:00+09:00", end: "2026-06-20T10:00:00+09:00" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for unknown id", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: "/api/events/9999/schedule",
      payload: { start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("mixed-offset: rejects 400 when end <= start across offsets", async () => {
    const id = insertUnscheduled(conn, "tz-order");
    const app = buildServer(conn.db);
    // 10:00+09:00 = 01:00Z; 02:00+00:00 = 02:00Z — end (02:00Z) IS after start (01:00Z): valid
    // But: 10:00+09:00 = 01:00Z; 01:30+00:00 = 01:30Z — also valid (30 min duration)
    // Test the real rejection: 10:00+09:00 = 01:00Z; 00:30+00:00 = 00:30Z < 01:00Z → 400
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${id}/schedule`,
      payload: { start: "2026-06-20T10:00:00+09:00", end: "2026-06-20T00:30:00+00:00" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("mixed-offset: rejects 409 when UTC blocker overlaps +09:00 selection", async () => {
    const id = insertUnscheduled(conn, "tz-conflict");
    // Blocker: 00:30Z–01:30Z = 09:30+09:00–10:30+09:00 overlaps 09:00+09:00–10:00+09:00
    insertScheduled(conn, "utc-conflict", "2026-06-20T00:30:00+00:00", "2026-06-20T01:30:00+00:00", "cairn", 0);
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PATCH", url: `/api/events/${id}/schedule`,
      payload: { start: "2026-06-20T09:00:00+09:00", end: "2026-06-20T10:00:00+09:00" }
    });
    expect(res.statusCode).toBe(409);
  });
});
