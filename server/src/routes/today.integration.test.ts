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
