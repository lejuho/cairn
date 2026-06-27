import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import type { FastifyInstance } from "fastify";

// Cycle-62 FR-SLOT-06C — due-task schedule prompts, read-only task slot
// candidate preview, and the task-owned one-date dismiss marker.

const tempDirs: string[] = [];
function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-task-slot-"));
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

type TaskOpts = { title?: string; estMinutes?: number | null; due?: string | null; status?: string; optional?: number; dismissedOn?: string | null };
function insertTask(conn: SqliteConnection, opts: TaskOpts = {}): number {
  const { title = "보고서", estMinutes = 90, due = TODAY, status = "todo", optional = 0, dismissedOn = null } = opts;
  const info = conn.sqlite
    .prepare("INSERT INTO tasks (title, est_minutes, due, status, optional, schedule_prompt_dismissed_on) VALUES (?, ?, ?, ?, ?, ?)")
    .run(title, estMinutes, due, status, optional, dismissedOn);
  return Number(info.lastInsertRowid);
}

function todayPromptIds(body: { data: { dueTaskSchedulePrompts: Array<{ id: number }> } }): number[] {
  return body.data.dueTaskSchedulePrompts.map((t) => t.id);
}
async function getToday(app: FastifyInstance, date = TODAY, now = NOW) {
  return JSON.parse((await app.inject({ method: "GET", url: `/api/today?date=${date}&now=${encodeURIComponent(now)}` })).body);
}

describe("migration 0007 — tasks.schedule_prompt_dismissed_on", () => {
  it("adds a nullable column with no rebuild; legacy rows read NULL", () => {
    const conn = makeTestDb();
    const cols = conn.sqlite.prepare("pragma table_info(tasks)").all() as Array<{ name: string; notnull: number }>;
    const col = cols.find((c) => c.name === "schedule_prompt_dismissed_on");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0);
    const id = insertTask(conn, { dismissedOn: null });
    const row = conn.sqlite.prepare("SELECT schedule_prompt_dismissed_on AS d FROM tasks WHERE id = ?").get(id) as { d: string | null };
    expect(row.d).toBeNull();
  });
});

describe("GET /api/today — due-task schedule prompts", () => {
  let app: FastifyInstance;
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); app = buildServer(conn.db); });

  it("surfaces due-today, overdue, and due-within-7-days tasks", async () => {
    const dueToday = insertTask(conn, { title: "오늘", due: TODAY });
    const overdue = insertTask(conn, { title: "지남", due: "2026-06-20" });
    const soon = insertTask(conn, { title: "곧", due: "2026-07-03" }); // +6d
    const body = await getToday(app);
    expect(todayPromptIds(body)).toEqual(expect.arrayContaining([dueToday, overdue, soon]));
    // also rendered as task_schedule_prompt cards
    const taskCards = body.data.cards.filter((c: { kind: string }) => c.kind === "task_schedule_prompt");
    expect(taskCards.length).toBe(3);
  });

  it("excludes due-after-7-days, done/dropped, invalid-due, and no-estimate tasks", async () => {
    insertTask(conn, { title: "먼미래", due: "2026-07-10" }); // +13d
    insertTask(conn, { title: "완료", due: TODAY, status: "done" });
    insertTask(conn, { title: "버림", due: TODAY, status: "dropped" });
    insertTask(conn, { title: "잘못된날짜", due: "2026-02-30" });
    insertTask(conn, { title: "추정없음", due: TODAY, estMinutes: null });
    const keep = insertTask(conn, { title: "유효", due: TODAY });
    const body = await getToday(app);
    expect(todayPromptIds(body)).toEqual([keep]);
  });

  it("sorts overdue before future due, then by due date asc", async () => {
    const futureLater = insertTask(conn, { title: "나중", due: "2026-07-02" });
    const overdueOlder = insertTask(conn, { title: "오래지남", due: "2026-06-18" });
    const futureSooner = insertTask(conn, { title: "곧", due: "2026-06-29" });
    const overdueNewer = insertTask(conn, { title: "조금지남", due: "2026-06-25" });
    const body = await getToday(app);
    // overdue (older due first), then future (sooner due first)
    expect(todayPromptIds(body)).toEqual([overdueOlder, overdueNewer, futureSooner].slice(0, 3));
    expect(todayPromptIds(body)).not.toContain(futureLater); // limited to 3
  });

  it("excludes a task dismissed for the Today date but surfaces it on a later date", async () => {
    const id = insertTask(conn, { title: "숨김", due: "2026-07-02" });
    // before dismiss
    expect(todayPromptIds(await getToday(app))).toContain(id);
    const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, data: { taskId: id, dismissedOn: TODAY } });
    // gone for TODAY
    expect(todayPromptIds(await getToday(app))).not.toContain(id);
    // reappears for a later date still within the due window
    const next = await getToday(app, "2026-06-28", "2026-06-28T08:00:00+09:00");
    expect(todayPromptIds(next)).toContain(id);
  });
});

describe("PATCH /api/tasks/:id/schedule-prompt/dismiss", () => {
  let app: FastifyInstance;
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); app = buildServer(conn.db); });

  it("is idempotent and writes only schedule_prompt_dismissed_on", async () => {
    const id = insertTask(conn, { due: TODAY });
    const before = conn.sqlite.prepare("SELECT title, est_minutes AS e, due, status, optional AS o, thread_id AS t FROM tasks WHERE id = ?").get(id);
    const first = await app.inject({ method: "PATCH", url: `/api/tasks/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
    const second = await app.inject({ method: "PATCH", url: `/api/tasks/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const after = conn.sqlite.prepare("SELECT title, est_minutes AS e, due, status, optional AS o, thread_id AS t, schedule_prompt_dismissed_on AS d FROM tasks WHERE id = ?").get(id) as Record<string, unknown>;
    expect({ title: after.title, e: after.e, due: after.due, status: after.status, o: after.o, t: after.t }).toEqual(before);
    expect(after.d).toBe(TODAY);
  });

  it("returns 404 unknown, 409 ineligible, 400 bad body", async () => {
    expect((await app.inject({ method: "PATCH", url: `/api/tasks/9999/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } })).statusCode).toBe(404);
    const done = insertTask(conn, { due: TODAY, status: "done" });
    const noEst = insertTask(conn, { due: TODAY, estMinutes: null });
    for (const id of [done, noEst]) {
      const res = await app.inject({ method: "PATCH", url: `/api/tasks/${id}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY } });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe("TASK_SCHEDULE_PROMPT_NOT_ELIGIBLE");
      const d = conn.sqlite.prepare("SELECT schedule_prompt_dismissed_on AS d FROM tasks WHERE id = ?").get(id) as { d: string | null };
      expect(d.d).toBeNull(); // no write
    }
    const ok = insertTask(conn, { due: TODAY });
    expect((await app.inject({ method: "PATCH", url: `/api/tasks/${ok}/schedule-prompt/dismiss`, payload: { dismissedOn: "2026-13-40" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/tasks/${ok}/schedule-prompt/dismiss`, payload: { dismissedOn: TODAY, eventId: 1 } })).statusCode).toBe(400);
  });
});

describe("GET /api/tasks/:id/slot-candidates (read-only preview)", () => {
  let app: FastifyInstance;
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); app = buildServer(conn.db); });

  function counts() {
    const tables = ["events", "tasks", "threads", "watchers", "annotations", "params", "links"];
    return Object.fromEntries(tables.map((t) => [t, (conn.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n]));
  }

  it("returns candidates whose duration equals the task estimate and writes nothing", async () => {
    const id = insertTask(conn, { due: TODAY, estMinutes: 90 });
    const before = counts();
    const beforeTask = conn.sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(id);

    const res = await app.inject({ method: "GET", url: `/api/tasks/${id}/slot-candidates?date=${TODAY}&now=${encodeURIComponent(NOW)}&days=7` });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.task.id).toBe(id);
    expect(data.candidates.length).toBeGreaterThan(0);
    for (const c of data.candidates) {
      expect((Date.parse(c.end) - Date.parse(c.start)) / 60000).toBe(90); // estMinutes duration, no 60-min fallback
    }
    // read-only
    expect(counts()).toEqual(before);
    expect(conn.sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(id)).toEqual(beforeTask);
  });

  it("returns 404 unknown task and 409 for ineligible (no estimate) task", async () => {
    expect((await app.inject({ method: "GET", url: `/api/tasks/9999/slot-candidates?date=${TODAY}&now=${encodeURIComponent(NOW)}` })).statusCode).toBe(404);
    const noEst = insertTask(conn, { due: TODAY, estMinutes: null });
    const res = await app.inject({ method: "GET", url: `/api/tasks/${noEst}/slot-candidates?date=${TODAY}&now=${encodeURIComponent(NOW)}` });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("TASK_SCHEDULE_PROMPT_NOT_ELIGIBLE");
  });

  it("returns 400 for a bad id or invalid query", async () => {
    const id = insertTask(conn, { due: TODAY });
    expect((await app.inject({ method: "GET", url: `/api/tasks/abc/slot-candidates?date=${TODAY}&now=${encodeURIComponent(NOW)}` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/tasks/${id}/slot-candidates?date=nope&now=${encodeURIComponent(NOW)}` })).statusCode).toBe(400);
  });
});
