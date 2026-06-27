import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import type { FastifyInstance } from "fastify";

// Cycle-63 FR-SLOT-07A — apply a due-task slot candidate: create one scheduled
// Cairn block event and record it on the task via tasks.scheduled_event_id.

const tempDirs: string[] = [];
function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-task-apply-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}
afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const TODAY = "2026-06-27";
const NOW = "2026-06-27T08:00:00+09:00";

function insertTask(conn: SqliteConnection, opts: { estMinutes?: number | null; due?: string | null; status?: string; threadId?: number | null } = {}): number {
  const { estMinutes = 90, due = TODAY, status = "todo", threadId = null } = opts;
  const info = conn.sqlite
    .prepare("INSERT INTO tasks (title, est_minutes, due, status, optional, thread_id) VALUES ('보고서', ?, ?, ?, 0, ?)")
    .run(estMinutes, due, status, threadId);
  return Number(info.lastInsertRowid);
}

type Candidate = { start: string; end: string };
async function firstCandidate(app: FastifyInstance, taskId: number): Promise<Candidate> {
  const res = JSON.parse((await app.inject({ method: "GET", url: `/api/tasks/${taskId}/slot-candidates?date=${TODAY}&now=${encodeURIComponent(NOW)}&days=7` })).body);
  return res.data.candidates[0];
}
async function applyBlock(app: FastifyInstance, taskId: number, start: string, end: string) {
  return app.inject({ method: "POST", url: `/api/tasks/${taskId}/schedule-block`, payload: { date: TODAY, now: NOW, days: 7, start, end } });
}
function getTaskRow(conn: SqliteConnection, id: number) {
  return conn.sqlite.prepare("SELECT status, due, est_minutes AS e, optional AS o, thread_id AS t, scheduled_event_id AS sid FROM tasks WHERE id = ?").get(id) as Record<string, unknown>;
}
function counts(conn: SqliteConnection): { events: number; tasks: number; links: number; threads: number; annotations: number; params: number } {
  const n = (t: string) => (conn.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { events: n("events"), tasks: n("tasks"), links: n("links"), threads: n("threads"), annotations: n("annotations"), params: n("params") };
}

describe("migration 0008 — tasks.scheduled_event_id", () => {
  it("adds a nullable column with no rebuild; legacy rows read NULL", () => {
    const conn = makeTestDb();
    const col = (conn.sqlite.prepare("pragma table_info(tasks)").all() as Array<{ name: string; notnull: number }>).find((c) => c.name === "scheduled_event_id");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0);
    const id = insertTask(conn);
    expect((conn.sqlite.prepare("SELECT scheduled_event_id AS s FROM tasks WHERE id = ?").get(id) as { s: number | null }).s).toBeNull();
  });
});

describe("POST /api/tasks/:id/schedule-block", () => {
  let app: FastifyInstance;
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); app = buildServer(conn.db); });

  it("creates exactly one scheduled Cairn block event and sets the task marker", async () => {
    const id = insertTask(conn);
    const c = await firstCandidate(app, id);
    const before = counts(conn);

    const res = await applyBlock(app, id, c.start, c.end);
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data;

    // created event has the exact A-slice shape
    expect(data.event).toMatchObject({ title: "보고서", type: "task", mode: "async", source: "cairn", selfImposed: 1, status: "planned", start: c.start, end: c.end });
    // task marker set; task fields otherwise unchanged
    expect(data.task.scheduledEventId).toBe(data.event.id);
    expect(data.task.status).toBe("todo"); // NOT mutated
    // only events +1 and the target task marker changed; NO links row
    const after = counts(conn);
    expect(after).toEqual({ ...before, events: before.events + 1 });
    expect(getTaskRow(conn, id)).toEqual({ status: "todo", due: TODAY, e: 90, o: 0, t: null, sid: data.event.id });
  });

  it("rejects a stale start/end not in the recomputed candidate list and writes nothing", async () => {
    const id = insertTask(conn);
    const before = counts(conn);
    // 13:00 is not one of the fixed candidate windows (09/11/14/16/19)
    const res = await applyBlock(app, id, "2026-06-27T13:00:00+09:00", "2026-06-27T14:30:00+09:00");
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("TASK_SLOT_STALE");
    expect(counts(conn)).toEqual(before);
    expect(getTaskRow(conn, id).sid).toBeNull();
  });

  it("rejects a second apply while an active block exists (TASK_ALREADY_SCHEDULED), no second event", async () => {
    const id = insertTask(conn);
    const c = await firstCandidate(app, id);
    expect((await applyBlock(app, id, c.start, c.end)).statusCode).toBe(201);
    const afterFirst = counts(conn);
    const second = await applyBlock(app, id, c.start, c.end);
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe("TASK_ALREADY_SCHEDULED");
    expect(counts(conn)).toEqual(afterFirst); // no second event
  });

  it("lets the task surface again after the scheduled block is cancelled", async () => {
    const id = insertTask(conn);
    const c = await firstCandidate(app, id);
    const eventId = JSON.parse((await applyBlock(app, id, c.start, c.end)).body).data.event.id;

    // active block → excluded from Today prompts
    let today = JSON.parse((await app.inject({ method: "GET", url: `/api/today?date=${TODAY}&now=${encodeURIComponent(NOW)}` })).body);
    expect(today.data.dueTaskSchedulePrompts.map((t: { id: number }) => t.id)).not.toContain(id);

    // cancel the block event → task resurfaces
    conn.sqlite.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(eventId);
    today = JSON.parse((await app.inject({ method: "GET", url: `/api/today?date=${TODAY}&now=${encodeURIComponent(NOW)}` })).body);
    expect(today.data.dueTaskSchedulePrompts.map((t: { id: number }) => t.id)).toContain(id);
  });

  it("returns 404 unknown, 409 ineligible, 400 bad body", async () => {
    const c = { start: "2026-06-27T09:00:00+09:00", end: "2026-06-27T10:30:00+09:00" };
    expect((await applyBlock(app, 9999, c.start, c.end)).statusCode).toBe(404);
    const done = insertTask(conn, { status: "done" });
    const noEst = insertTask(conn, { estMinutes: null });
    for (const bad of [done, noEst]) {
      const res = await applyBlock(app, bad, c.start, c.end);
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe("TASK_SCHEDULE_PROMPT_NOT_ELIGIBLE");
    }
    const ok = insertTask(conn);
    // end before start (strict body)
    expect((await app.inject({ method: "POST", url: `/api/tasks/${ok}/schedule-block`, payload: { date: TODAY, now: NOW, days: 7, start: c.end, end: c.start } })).statusCode).toBe(400);
    // injected field
    expect((await app.inject({ method: "POST", url: `/api/tasks/${ok}/schedule-block`, payload: { date: TODAY, now: NOW, days: 7, start: c.start, end: c.end, apply: true } })).statusCode).toBe(400);
  });
});
