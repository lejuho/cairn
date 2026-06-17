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

describe("POST /api/threads", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildServer(makeTestDb().db);
  });

  it("creates thread with required name, defaults to active status", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { name: "Project Alpha" }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe("Project Alpha");
    expect(body.data.status).toBe("active");
    expect(body.data.id).toBeTypeOf("number");
  });

  it("creates thread with optional fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { name: "Trip", kind: "project", goal: "Visit Japan", deadline: "2026-09-01" }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.kind).toBe("project");
    expect(body.data.goal).toBe("Visit Japan");
    expect(body.data.deadline).toBe("2026-09-01");
  });

  it("rejects blank name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: { name: "  " }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it("rejects missing name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/threads",
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/threads", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });

  afterEach(() => conn.sqlite.close());

  it("returns empty list when no threads exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/threads" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it("returns list sorted newest-first (desc createdAt, desc id)", async () => {
    await app.inject({ method: "POST", url: "/api/threads", payload: { name: "First" } });
    await app.inject({ method: "POST", url: "/api/threads", payload: { name: "Second" } });

    const res = await app.inject({ method: "GET", url: "/api/threads" });
    const summaries = res.json().data as Array<{ thread: { name: string } }>;
    expect(summaries).toHaveLength(2);
    // Newest inserted (Second) must appear first
    expect(summaries[0]!.thread.name).toBe("Second");
    expect(summaries[1]!.thread.name).toBe("First");
  });

  it("returns summaries with event and task counts", async () => {
    const thread = await app.inject({
      method: "POST", url: "/api/threads", payload: { name: "Alpha" }
    });
    const tid = thread.json().data.id as number;

    await app.inject({
      method: "POST", url: "/api/events",
      payload: { title: "Kickoff", start: "2026-06-20T10:00:00+00:00", end: "2026-06-20T11:00:00+00:00" }
    });
    // Insert event with threadId directly (create API doesn't accept threadId yet)
    conn.sqlite
      .prepare("UPDATE events SET thread_id = ? WHERE title = 'Kickoff'")
      .run(tid);

    await app.inject({
      method: "POST", url: "/api/tasks", payload: { title: "Prep", estMinutes: 30 }
    });
    conn.sqlite
      .prepare("UPDATE tasks SET thread_id = ? WHERE title = 'Prep'")
      .run(tid);

    const res = await app.inject({ method: "GET", url: "/api/threads" });
    const summaries = res.json().data as Array<{ thread: { id: number }; eventCount: number; taskCount: number }>;
    const summary = summaries.find((s) => s.thread.id === tid)!;
    expect(summary.eventCount).toBe(1);
    expect(summary.taskCount).toBe(1);
  });
});

describe("GET /api/threads/:id", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });

  afterEach(() => conn.sqlite.close());

  it("returns 404 for missing thread", async () => {
    const res = await app.inject({ method: "GET", url: "/api/threads/9999" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for non-integer id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/threads/abc" });
    expect(res.statusCode).toBe(400);
  });

  it("returns thread detail with events sorted by start (null-start last)", async () => {
    const thread = await app.inject({
      method: "POST", url: "/api/threads", payload: { name: "Beta" }
    });
    const tid = thread.json().data.id as number;

    // Insert events in reverse order; one with null start
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES (?,?,?,'cairn',1,'planned',?)")
      .run("Late", "2026-06-20T14:00:00+00:00", "2026-06-20T15:00:00+00:00", tid);
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES (?,?,?,'cairn',1,'planned',?)")
      .run("Early", "2026-06-20T10:00:00+00:00", "2026-06-20T11:00:00+00:00", tid);
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES (?,NULL,NULL,'cairn',1,'planned',?)")
      .run("NoDate", tid);

    const res = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    expect(res.statusCode).toBe(200);
    const { events } = res.json().data as { events: Array<{ title: string }> };
    expect(events[0]!.title).toBe("Early");
    expect(events[1]!.title).toBe("Late");
    expect(events[2]!.title).toBe("NoDate");
  });

  it("computes progress excluding cancelled/dropped", async () => {
    const thread = await app.inject({
      method: "POST", url: "/api/threads", payload: { name: "Gamma" }
    });
    const tid = thread.json().data.id as number;

    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES (?,?,?,'cairn',1,'done',?)")
      .run("Done event", "2026-06-20T10:00:00+00:00", "2026-06-20T11:00:00+00:00", tid);
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES (?,?,?,'cairn',1,'cancelled',?)")
      .run("Cancelled", "2026-06-20T12:00:00+00:00", "2026-06-20T13:00:00+00:00", tid);
    conn.sqlite
      .prepare("INSERT INTO tasks (title, est_minutes, status, thread_id) VALUES (?,2,'todo',?)")
      .run("Active task", tid);

    const res = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    const { progress } = res.json().data as { progress: { done: number; total: number } };
    // cancelled excluded → total=2 (done event + todo task), done=1
    expect(progress.total).toBe(2);
    expect(progress.done).toBe(1);
  });
});
