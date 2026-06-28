import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import type { FastifyInstance } from "fastify";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const DATE = "2026-06-16";
const NOW = "2026-06-16T09:00:00+00:00";
const EVENT_START = "2026-06-16T10:00:00+00:00";
const EVENT_END = "2026-06-16T11:00:00+00:00";

describe("POST /api/events", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const conn = makeTestDb();
    app = buildServer(conn.db);
  });

  it("creates an event and returns it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "Team sync", start: EVENT_START, end: EVENT_END }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.title).toBe("Team sync");
    expect(body.data.source).toBe("cairn");
    expect(body.data.status).toBe("planned");
  });

  it("rejects end <= start", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "Bad", start: EVENT_END, end: EVENT_START }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(res.json().error.code).toBe("INVALID_TIME_RANGE");
  });

  it("rejects missing title", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { start: EVENT_START, end: EVENT_END }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/tasks", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const conn = makeTestDb();
    app = buildServer(conn.db);
  });

  it("creates a task and returns it with status=todo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Quick reply", estMinutes: 2 }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("todo");
    expect(body.data.estMinutes).toBe(2);
  });

  it("rejects missing title", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { estMinutes: 1 }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/tasks/:id/status", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const conn = makeTestDb();
    app = buildServer(conn.db);
  });

  it("updates status and returns the task", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Do it" }
    });
    const id = created.json().data.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${id}/status`,
      payload: { status: "done" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("done");
  });

  it("returns 404 for missing task", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/99999/status",
      payload: { status: "done" }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects invalid status", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Task" }
    });
    const id = created.json().data.id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${id}/status`,
      payload: { status: "invalid" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/watchers", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const conn = makeTestDb();
    app = buildServer(conn.db);
  });

  it("creates a watcher with kind=A, armed=1", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/watchers",
      payload: { label: "Passport renewal", threshold: "2026-06-10" }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.kind).toBe("A");
    expect(body.data.armed).toBe(1);
    expect(JSON.parse(body.data.rule)).toEqual({
      type: "date_threshold",
      fireOn: "2026-06-10"
    });
  });

  it("rejects invalid threshold format", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/watchers",
      payload: { label: "Bad", threshold: "not-a-date" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/watchers/:id/snooze", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const conn = makeTestDb();
    app = buildServer(conn.db);
  });

  it("updates snoozedUntil", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/watchers",
      payload: { label: "W", threshold: "2026-06-10" }
    });
    const id = created.json().data.id;
    const until = "2026-06-17T00:00:00+00:00";

    const res = await app.inject({
      method: "PATCH",
      url: `/api/watchers/${id}/snooze`,
      payload: { snoozedUntil: until }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.snoozedUntil).toBe(until);
  });

  it("returns 404 for missing watcher", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/watchers/99999/snooze",
      payload: { snoozedUntil: "2026-06-17T00:00:00+00:00" }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

describe("GET /api/today", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const conn = makeTestDb();
    app = buildServer(conn.db);
  });

  it("returns quiet state when no events, tasks, or watchers", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.state).toBe("quiet");
    expect(body.data.nextEvent).toBeNull();
    expect(body.data.cards).toHaveLength(0);
  });

  it("returns nextEvent for an upcoming event on the date", async () => {
    await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "Standup", start: EVENT_START, end: EVENT_END }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    const body = res.json();
    expect(body.data.state).toBe("live");
    expect(body.data.nextEvent.title).toBe("Standup");
    expect(body.data.cards.some((c: { kind: string }) => c.kind === "next_event")).toBe(true);
  });

  it("does not return event from a different date", async () => {
    await app.inject({
      method: "POST",
      url: "/api/events",
      payload: {
        title: "Tomorrow",
        start: "2026-06-17T10:00:00+00:00",
        end: "2026-06-17T11:00:00+00:00"
      }
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    expect(res.json().data.state).toBe("quiet");
  });

  it("returns conflict cards for overlapping events", async () => {
    await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "A", start: "2026-06-16T10:00:00+00:00", end: "2026-06-16T12:00:00+00:00" }
    });
    await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "B", start: "2026-06-16T11:00:00+00:00", end: "2026-06-16T13:00:00+00:00" }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    const body = res.json();
    expect(body.data.conflicts).toHaveLength(1);
    expect(body.data.cards.some((c: { kind: string }) => c.kind === "conflict")).toBe(true);
  });

  it("surfaces two-minute todo tasks but not longer or done tasks", async () => {
    await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Quick", estMinutes: 2 }
    });
    await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Long", estMinutes: 30 }
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Done already", estMinutes: 1 }
    });
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${created.json().data.id}/status`,
      payload: { status: "done" }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    const body = res.json();
    expect(body.data.twoMinuteTasks).toHaveLength(1);
    expect(body.data.twoMinuteTasks[0].title).toBe("Quick");
  });

  it("patching task to done removes it from Today", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Quick", estMinutes: 2 }
    });
    const id = created.json().data.id;

    const before = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    expect(before.json().data.twoMinuteTasks).toHaveLength(1);

    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${id}/status`,
      payload: { status: "done" }
    });

    const after = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    expect(after.json().data.twoMinuteTasks).toHaveLength(0);
    expect(after.json().data.state).toBe("quiet");
  });

  it("watcher with threshold <= date surfaces as bubble", async () => {
    await app.inject({
      method: "POST",
      url: "/api/watchers",
      payload: { label: "Renew passport", threshold: "2026-06-10" }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    const body = res.json();
    expect(body.data.watcherBubbles).toHaveLength(1);
    expect(body.data.cards.some((c: { kind: string }) => c.kind === "watcher")).toBe(true);
  });

  it("snoozed watcher is hidden from Today", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/watchers",
      payload: { label: "Renew passport", threshold: "2026-06-10" }
    });
    const id = created.json().data.id;

    await app.inject({
      method: "PATCH",
      url: `/api/watchers/${id}/snooze`,
      payload: { snoozedUntil: "2026-06-17T00:00:00+00:00" }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    expect(res.json().data.watcherBubbles).toHaveLength(0);
    expect(res.json().data.state).toBe("quiet");
  });

  it("returns 400 for missing query params", async () => {
    const res = await app.inject({ method: "GET", url: "/api/today" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

// ── needs_review ──────────────────────────────────────────────────────────────

// NOW: 2026-06-16T12:00:00+00:00 (UTC noon)
// 36h window start: 2026-06-15T00:00:00+00:00
const NR_NOW = "2026-06-16T12:00:00+00:00";
const NR_DATE = "2026-06-16";

function insertEndedEvent(
  conn: SqliteConnection,
  overrides: { end?: string; status?: string } = {}
): number {
  const end = overrides.end ?? "2026-06-16T10:00:00+00:00"; // 2h before NOW
  const status = overrides.status ?? "planned";
  const result = conn.sqlite
    .prepare(
      "INSERT INTO events (title, start, end, source, self_imposed, status) VALUES (?, ?, ?, 'cairn', 1, ?)"
    )
    .run("Past Event", "2026-06-16T09:00:00+00:00", end, status);
  return Number(result.lastInsertRowid);
}

describe("GET /api/today — needs_review candidates", () => {
  it("ended planned event with no annotation appears as needs_review", async () => {
    const conn = makeTestDb();
    insertEndedEvent(conn, { status: "planned" });
    const app = buildServer(conn.db);

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.needsReviewEvents).toHaveLength(1);
    expect(body.data.cards.some((c: { kind: string }) => c.kind === "needs_review")).toBe(true);
    conn.sqlite.close();
  });

  it("ended confirmed event with no annotation appears as needs_review", async () => {
    const conn = makeTestDb();
    insertEndedEvent(conn, { status: "confirmed" });
    const app = buildServer(conn.db);

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    expect(res.json().data.needsReviewEvents).toHaveLength(1);
    conn.sqlite.close();
  });

  it("event with existing annotation is excluded", async () => {
    const conn = makeTestDb();
    const eventId = insertEndedEvent(conn);
    conn.sqlite
      .prepare("INSERT INTO annotations (event_id, reason_text) VALUES (?, ?)")
      .run(eventId, "already annotated");
    const app = buildServer(conn.db);

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    expect(res.json().data.needsReviewEvents).toHaveLength(0);
    conn.sqlite.close();
  });

  it("future event is excluded", async () => {
    const conn = makeTestDb();
    insertEndedEvent(conn, { end: "2026-06-16T14:00:00+00:00" }); // 2h after NOW
    const app = buildServer(conn.db);

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    expect(res.json().data.needsReviewEvents).toHaveLength(0);
    conn.sqlite.close();
  });

  it("event older than 36 hours is excluded", async () => {
    const conn = makeTestDb();
    // 37h before NR_NOW
    insertEndedEvent(conn, { end: "2026-06-14T23:00:00+00:00" });
    const app = buildServer(conn.db);

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    expect(res.json().data.needsReviewEvents).toHaveLength(0);
    conn.sqlite.close();
  });

  it.each(["done", "cancelled", "moved", "late"])(
    "%s event is excluded from needs_review",
    async (status) => {
      const conn = makeTestDb();
      insertEndedEvent(conn, { status });
      const app = buildServer(conn.db);

      const res = await app.inject({
        method: "GET",
        url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
      });
      expect(res.json().data.needsReviewEvents).toHaveLength(0);
      conn.sqlite.close();
    }
  );

  it("limits candidates to 3, sorted most-recent-ended first", async () => {
    const conn = makeTestDb();
    // Insert 4 ended events at different times
    const ends = [
      "2026-06-16T08:00:00+00:00",
      "2026-06-16T09:00:00+00:00",
      "2026-06-16T10:00:00+00:00",
      "2026-06-16T11:00:00+00:00" // most recent, should be first
    ];
    for (const end of ends) {
      conn.sqlite
        .prepare(
          "INSERT INTO events (title, start, end, source, self_imposed, status) VALUES (?, ?, ?, 'cairn', 1, 'planned')"
        )
        .run(`Event ${end}`, "2026-06-16T07:00:00+00:00", end);
    }
    const app = buildServer(conn.db);

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    const events = res.json().data.needsReviewEvents as Array<{ end: string }>;
    expect(events).toHaveLength(3);
    // Most recent first
    expect(events[0]!.end).toBe("2026-06-16T11:00:00+00:00");
    expect(events[1]!.end).toBe("2026-06-16T10:00:00+00:00");
    conn.sqlite.close();
  });

  it("needs_review cards appear after two_minute_task in card priority", async () => {
    const conn = makeTestDb();
    insertEndedEvent(conn);
    // Insert a 2-min task
    conn.sqlite
      .prepare(
        "INSERT INTO tasks (title, est_minutes, status) VALUES (?, ?, 'todo')"
      )
      .run("Quick task", 2);
    const app = buildServer(conn.db);

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    const cards = res.json().data.cards as Array<{ kind: string }>;
    const taskIdx = cards.findIndex((c) => c.kind === "two_minute_task");
    const reviewIdx = cards.findIndex((c) => c.kind === "needs_review");
    expect(taskIdx).toBeGreaterThanOrEqual(0);
    expect(reviewIdx).toBeGreaterThan(taskIdx);
    conn.sqlite.close();
  });

  it("Today route works without gateway (deterministic)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db); // no gateway

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    expect(res.statusCode).toBe(200);
    conn.sqlite.close();
  });

  it("each needs_review card carries placement metadata", async () => {
    const conn = makeTestDb();
    insertEndedEvent(conn); // ended 2h before NOW
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    const card = (res.json().data.cards as Array<{ kind: string; placement?: { mode: string; ageHours: number | null } }>)
      .find((c) => c.kind === "needs_review");
    expect(card?.placement).toBeDefined();
    // ended 2h ago, no transitions → no_context
    expect(card!.placement!.mode).toBe("no_context");
    expect(card!.placement!.ageHours).toBe(2);
    conn.sqlite.close();
  });

  it("stale_due when reviewed event ended >= 12h before now (within 36h window)", async () => {
    const conn = makeTestDb();
    // ended 13h before NOW (2026-06-15T23:00Z), inside the 36h candidacy window
    insertEndedEvent(conn, { end: "2026-06-15T23:00:00+00:00" });
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    const card = (res.json().data.cards as Array<{ kind: string; placement?: { mode: string; ageHours: number } }>)
      .find((c) => c.kind === "needs_review");
    expect(card!.placement!.mode).toBe("stale_due");
    expect(card!.placement!.ageHours).toBe(13);
    conn.sqlite.close();
  });

  it("top-level needsReviewEvents stays event-only (no placement)", async () => {
    const conn = makeTestDb();
    insertEndedEvent(conn);
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}`
    });
    const events = res.json().data.needsReviewEvents as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty("placement");
    conn.sqlite.close();
  });

  it("placement read path does not change event/annotation row counts", async () => {
    const conn = makeTestDb();
    insertEndedEvent(conn);
    const eventsBefore = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const annBefore = conn.sqlite.prepare("SELECT count(*) c FROM annotations").get() as { c: number };
    const app = buildServer(conn.db);
    await app.inject({ method: "GET", url: `/api/today?date=${NR_DATE}&now=${encodeURIComponent(NR_NOW)}` });
    const eventsAfter = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const annAfter = conn.sqlite.prepare("SELECT count(*) c FROM annotations").get() as { c: number };
    expect(eventsAfter.c).toBe(eventsBefore.c);
    expect(annAfter.c).toBe(annBefore.c);
    conn.sqlite.close();
  });
});

describe("GET /api/today — dayEvents", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });

  afterEach(() => conn.sqlite.close());

  it("returns dayEvents sorted by start for matching planned/confirmed events", async () => {
    // Insert in reverse order; expect sorted output
    await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "Later",   start: "2026-06-16T14:00:00+00:00", end: "2026-06-16T15:00:00+00:00" }
    });
    await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "Earlier", start: "2026-06-16T10:00:00+00:00", end: "2026-06-16T11:00:00+00:00" }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    const { dayEvents } = res.json().data as { dayEvents: Array<{ title: string }> };
    expect(dayEvents).toHaveLength(2);
    expect(dayEvents[0]!.title).toBe("Earlier");
    expect(dayEvents[1]!.title).toBe("Later");
  });

  it("excludes events from a different date", async () => {
    await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "Tomorrow", start: "2026-06-17T10:00:00+00:00", end: "2026-06-17T11:00:00+00:00" }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    expect(res.json().data.dayEvents).toHaveLength(0);
  });

  it("returns quiet state when dayEvents and cards are empty", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    const data = res.json().data;
    expect(data.state).toBe("quiet");
    expect(data.dayEvents).toHaveLength(0);
  });

  it("returns live state when dayEvents exist even if all events ended", async () => {
    // Event ended before NOW (2026-06-16T09:00:00)
    await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { title: "Past", start: "2026-06-16T07:00:00+00:00", end: "2026-06-16T08:00:00+00:00" }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}`
    });
    const data = res.json().data;
    expect(data.state).toBe("live");
    expect(data.dayEvents).toHaveLength(1);
    expect(data.nextEvent).toBeNull(); // ended already
  });
});

// ── domain filter (cycle-67 FR-DOM-01) ───────────────────────────────────────

describe("GET /api/today — domain filter", () => {
  const D = "2026-06-16";
  const N = "2026-06-16T09:00:00+00:00";
  function setup() {
    const conn = makeTestDb();
    const sq = conn.sqlite;
    const thread = (name: string, domain: string) =>
      Number(sq.prepare("INSERT INTO threads (name, domain) VALUES (?, ?)").run(name, domain).lastInsertRowid);
    const event = (title: string, start: string, end: string, threadId: number | null) =>
      Number(sq.prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES (?, ?, ?, 'cairn', 1, 'planned', ?)").run(title, start, end, threadId).lastInsertRowid);
    const task = (title: string, threadId: number | null) =>
      Number(sq.prepare("INSERT INTO tasks (title, est_minutes, status, thread_id) VALUES (?, 2, 'todo', ?)").run(title, threadId).lastInsertRowid);
    const tP = thread("개인", "personal");
    const tW = thread("업무", "work");
    // P and W overlap (10-12 vs 11-13) → a conflict only when BOTH are present.
    event("P회의", "2026-06-16T10:00:00+00:00", "2026-06-16T12:00:00+00:00", tP);
    event("W회의", "2026-06-16T11:00:00+00:00", "2026-06-16T13:00:00+00:00", tW);
    event("미분류", "2026-06-16T14:00:00+00:00", "2026-06-16T15:00:00+00:00", null); // threadless
    task("P2분", tP);
    task("W2분", tW);
    task("미분류2분", null); // threadless
    return { conn, app: buildServer(conn.db) };
  }
  const get = (app: FastifyInstance, domain?: string) =>
    app.inject({ method: "GET", url: `/api/today?date=${D}&now=${encodeURIComponent(N)}${domain ? `&domain=${domain}` : ""}` }).then((r) => r.json().data);

  it("all (default) includes every thread-linked and threadless item and the cross-domain conflict", async () => {
    const { conn, app } = setup();
    const data = await get(app);
    const titles = data.cards.filter((c: { kind: string }) => c.kind === "two_minute_task").map((c: { task: { title: string } }) => c.task.title);
    expect(titles.sort()).toEqual(["P2분", "W2분", "미분류2분"]);
    expect(data.conflicts).toHaveLength(1); // P vs W overlap
    conn.sqlite.close();
  });

  it("personal includes only personal-thread items and drops the cross-domain conflict", async () => {
    const { conn, app } = setup();
    const data = await get(app, "personal");
    const tasks = data.cards.filter((c: { kind: string }) => c.kind === "two_minute_task").map((c: { task: { title: string } }) => c.task.title);
    expect(tasks).toEqual(["P2분"]); // W2분 + threadless excluded
    expect(data.nextEvent.title).toBe("P회의");
    expect(data.conflicts).toHaveLength(0); // only one event remains → conflict filtered pre-surface
    conn.sqlite.close();
  });

  it("work includes only work-thread items", async () => {
    const { conn, app } = setup();
    const data = await get(app, "work");
    const tasks = data.cards.filter((c: { kind: string }) => c.kind === "two_minute_task").map((c: { task: { title: string } }) => c.task.title);
    expect(tasks).toEqual(["W2분"]);
    expect(data.nextEvent.title).toBe("W회의");
    expect(data.conflicts).toHaveLength(0);
    conn.sqlite.close();
  });

  it("rejects an invalid domain with 400 and writes nothing", async () => {
    const { conn, app } = setup();
    const sq = conn.sqlite;
    const counts = () => ["threads", "events", "tasks", "watchers", "annotations", "params", "resources", "links", "thread_links"].map((t) => (sq.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
    const before = counts();
    const res = await app.inject({ method: "GET", url: `/api/today?date=${D}&now=${encodeURIComponent(N)}&domain=office` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    // a valid domain GET also mutates nothing
    await get(app, "work");
    expect(counts()).toEqual(before);
    conn.sqlite.close();
  });
});

describe("GET /api/today location context (cycle-75)", () => {
  let app: FastifyInstance;
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); app = buildServer(conn.db); });

  function insertEvent(title: string, location: string | null): number {
    const r = conn.sqlite
      .prepare("INSERT INTO events (title, start, end, location, source, self_imposed, status) VALUES (?, ?, ?, ?, 'cairn', 1, 'planned')")
      .run(title, EVENT_START, EVENT_END, location);
    return Number(r.lastInsertRowid);
  }
  function seedGeocode(normalized: string, over: Partial<{ status: string; lat: number | null; lng: number | null; label: string | null; confidence: string; uncertainty: string | null }> = {}) {
    conn.sqlite
      .prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, latitude, longitude, display_label, confidence, provider_status, uncertainty_json) VALUES ('google', ?, ?, ?, ?, ?, ?, ?, 'OK', ?)")
      .run(normalized, normalized, over.status ?? "resolved", over.lat ?? 37.55, over.lng ?? 126.98, over.label ?? "N Seoul Tower", over.confidence ?? "high", over.uncertainty ?? '{"locationType":"ROOFTOP","partialMatch":false}');
  }
  const get = () => app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}` });
  const cacheCount = () => (conn.sqlite.prepare("SELECT count(*) AS n FROM geocode_cache").get() as { n: number }).n;
  const ctxFor = (body: { data: { locationContexts: { eventId: number }[] } }, id: number) => body.data.locationContexts.find((c) => c.eventId === id);

  it("returns a cache-backed resolved context and an uncached context, with NO geocode_cache write", async () => {
    const resolvedId = insertEvent("타워 회의", "Seoul Tower");
    const uncachedId = insertEvent("강남 회의", "강남역");
    seedGeocode("seoul tower");
    const before = cacheCount();

    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ctxFor(body, resolvedId)).toMatchObject({ status: "resolved", latitude: 37.55, longitude: 126.98, displayLabel: "N Seoul Tower", confidence: "high", provider: "google" });
    expect(ctxFor(body, uncachedId)).toMatchObject({ status: "uncached", latitude: null, longitude: null });
    expect(cacheCount()).toBe(before); // Today never writes to the cache
  });

  it("blank location → missing context", async () => {
    const blankId = insertEvent("장소 없음", null);
    const res = await get();
    expect(ctxFor(res.json(), blankId)).toMatchObject({ status: "missing", latitude: null, longitude: null });
  });

  it("malformed cache uncertainty JSON does not crash Today (fails open to null)", async () => {
    const id = insertEvent("깨진 데이터", "Seoul Tower");
    conn.sqlite
      .prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, latitude, longitude, display_label, confidence, provider_status, uncertainty_json) VALUES ('google', 'seoul tower', 'Seoul Tower', 'resolved', 37.55, 126.98, 'N Seoul Tower', 'high', 'OK', '{bad json')")
      .run();
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(ctxFor(res.json(), id)).toMatchObject({ status: "resolved", uncertainty: null });
  });

  it("serves location context without a map gateway (cache-only, provider-independent)", async () => {
    // buildServer(conn.db) wires NO mapGateway — Today must still return 200 + contexts.
    insertEvent("타워", "Seoul Tower");
    seedGeocode("seoul tower");
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.locationContexts.length).toBeGreaterThan(0);
  });

  it("attaches contexts for the needs_review and unscheduled (schedule_prompt) event input paths", async () => {
    // needs_review: ended in the recent past (within the 36h window before NOW), no annotation.
    const reviewId = Number(conn.sqlite.prepare("INSERT INTO events (title, start, end, location, source, self_imposed, status) VALUES ('지난 회의', '2026-06-16T07:00:00+00:00', '2026-06-16T08:00:00+00:00', 'Hongdae', 'cairn', 1, 'planned')").run().lastInsertRowid);
    // unscheduled: no start/end → only in unscheduledEvents (schedule_prompt), never dayEvents.
    const unschedId = Number(conn.sqlite.prepare("INSERT INTO events (title, start, end, location, source, self_imposed, status) VALUES ('미정 일정', NULL, NULL, 'Itaewon', 'cairn', 1, 'planned')").run().lastInsertRowid);
    seedGeocode("hongdae", { label: "Hongdae Station" });
    seedGeocode("itaewon", { label: "Itaewon" });
    const before = cacheCount();

    const body = (await get()).json();
    // needsReviewEvents path
    expect(body.data.needsReviewEvents.some((e: { id: number }) => e.id === reviewId)).toBe(true);
    expect(ctxFor(body, reviewId)).toMatchObject({ status: "resolved", displayLabel: "Hongdae Station" });
    // unscheduledEvents path — proven independently of dayEvents
    expect(body.data.unscheduledEvents.some((e: { id: number }) => e.id === unschedId)).toBe(true);
    expect(body.data.dayEvents.some((e: { id: number }) => e.id === unschedId)).toBe(false);
    expect(ctxFor(body, unschedId)).toMatchObject({ status: "resolved", displayLabel: "Itaewon" });
    expect(cacheCount()).toBe(before); // still no Today cache write
  });
});

describe("GET /api/today travel evidence (cycle-76)", () => {
  const D = "2026-06-16";
  const N = "2026-06-16T09:00:00+00:00";
  const googleGateway = {
    provider: "google" as const,
    smoke: async () => ({ ok: false as const, error: { code: "unavailable" as const, message: "n/a" } }),
    geocodeAddress: async () => ({ ok: false as const, error: { code: "unavailable" as const, message: "n/a" } }),
    travelTime: async () => ({ ok: false as const, error: { code: "unavailable" as const, message: "n/a" } })
  };

  it("attaches fresh travel evidence to adjacent scheduled pairs on the Today feasibility surface", async () => {
    const conn = makeTestDb();
    conn.sqlite.prepare("INSERT INTO events (title, start, end, location, source, self_imposed, status) VALUES ('A', '2026-06-16T10:00:00+00:00','2026-06-16T10:45:00+00:00','Alpha','cairn',1,'planned')").run();
    conn.sqlite.prepare("INSERT INTO events (title, start, end, location, source, self_imposed, status) VALUES ('B', '2026-06-16T11:30:00+00:00','2026-06-16T12:15:00+00:00','Beta','cairn',1,'planned')").run();
    conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, latitude, longitude, confidence) VALUES ('google','alpha','Alpha','resolved',37.5,127.0,'high')").run();
    conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, latitude, longitude, confidence) VALUES ('google','beta','Beta','resolved',37.6,127.1,'high')").run();
    conn.sqlite.prepare("INSERT INTO travel_time_cache (provider, mode, origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds, duration_minutes, status, last_checked_at) VALUES ('google','drive','alpha','beta',37.5,127,37.6,127.1,1200,20,'resolved','2026-06-16T08:00:00+00:00')").run();

    const res = await buildServer(conn.db, undefined, googleGateway).inject({ method: "GET", url: `/api/today?date=${D}&now=${encodeURIComponent(N)}` });
    expect(res.statusCode).toBe(200);
    const tc = res.json().data.feasibility.transitionCosts;
    expect(tc[0].travel).toMatchObject({ status: "fresh", durationMinutes: 20, provider: "google" });
  });
});
