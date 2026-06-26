import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadDetailSchema } from "@cairn/shared";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const tempDirs: string[] = [];
function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-resume-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}
afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertThread(conn: SqliteConnection, name: string, status: string): number {
  return Number(conn.sqlite.prepare("INSERT INTO threads (name, kind, status) VALUES (?, 'trip', ?)").run(name, status).lastInsertRowid);
}
function insertEvent(conn: SqliteConnection, threadId: number): number {
  return Number(conn.sqlite.prepare("INSERT INTO events (title, thread_id, source, self_imposed, status) VALUES ('E',?, 'cairn',1,'done')").run(threadId).lastInsertRowid);
}
function insertTask(conn: SqliteConnection, threadId: number): void {
  conn.sqlite.prepare("INSERT INTO tasks (title, thread_id, status, optional) VALUES ('T',?,'done',0)").run(threadId);
}
const counts = (conn: SqliteConnection) => ({
  events: (conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number }).c,
  tasks: (conn.sqlite.prepare("SELECT count(*) c FROM tasks").get() as { c: number }).c,
  annotations: (conn.sqlite.prepare("SELECT count(*) c FROM annotations").get() as { c: number }).c,
  links: (conn.sqlite.prepare("SELECT count(*) c FROM links").get() as { c: number }).c
});

describe("PATCH /api/threads/:id/resume + GET resume (cycle-56)", () => {
  it("migration-backed GET returns default resume data", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "여행", "active");
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t}` })).json().data;
    expect(ThreadDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.resume).toEqual({ resumeRelevant: false, starSituation: null, starAction: null, starResult: null, skillsTags: [] });
  });

  it("saves all fields on a completed thread and GET returns them", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "여행", "done");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: {
      resumeRelevant: true, starSituation: "  상황  ", starAction: "행동", starResult: "결과", skillsTags: ["  계획 ", "조율"]
    } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ resumeRelevant: true, starSituation: "상황", starAction: "행동", starResult: "결과", skillsTags: ["계획", "조율"] });
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t}` })).json().data;
    expect(detail.resume.starSituation).toBe("상황");
    expect(detail.resume.skillsTags).toEqual(["계획", "조율"]);
    // skills_tags stored as JSON
    const raw = conn.sqlite.prepare("SELECT skills_tags FROM threads WHERE id=?").get(t) as { skills_tags: string };
    expect(JSON.parse(raw.skills_tags)).toEqual(["계획", "조율"]);
  });

  it("partial patch preserves unspecified fields", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "여행", "done");
    const app = buildServer(conn.db);
    await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: { starSituation: "상황", skillsTags: ["계획"] } });
    // toggle resumeRelevant only — must not clear starSituation/skills
    const res = await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: { resumeRelevant: true } });
    expect(res.json().data).toEqual({ resumeRelevant: true, starSituation: "상황", starAction: null, starResult: null, skillsTags: ["계획"] });
  });

  it("blank text clears to null; empty skills array clears skills", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "여행", "done");
    const app = buildServer(conn.db);
    await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: { starSituation: "상황", skillsTags: ["계획"] } });
    const res = await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: { starSituation: "   ", skillsTags: [] } });
    expect(res.json().data.starSituation).toBeNull();
    expect(res.json().data.skillsTags).toEqual([]);
  });

  it("returns 409 THREAD_NOT_DONE for active/paused/dropped and writes nothing", async () => {
    const conn = makeTestDb();
    for (const st of ["active", "paused", "dropped"]) {
      const t = insertThread(conn, `s-${st}`, st);
      const app = buildServer(conn.db);
      const res = await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: { resumeRelevant: true } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("THREAD_NOT_DONE");
      const row = conn.sqlite.prepare("SELECT resume_relevant FROM threads WHERE id=?").get(t) as { resume_relevant: number };
      expect(row.resume_relevant).toBe(0); // unchanged
    }
  });

  it("rejects unknown id (404), bad id (400), empty body (400), injected field (400)", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "여행", "done");
    const app = buildServer(conn.db);
    expect((await app.inject({ method: "PATCH", url: "/api/threads/9999/resume", payload: { resumeRelevant: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: "/api/threads/0/resume", payload: { resumeRelevant: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: { starTask: "x" } })).statusCode).toBe(400);
  });

  it("mutates only the target thread resume row — no events/tasks/annotations/links writes", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "여행", "done");
    insertEvent(conn, t);
    insertTask(conn, t);
    const before = counts(conn);
    const app = buildServer(conn.db);
    await app.inject({ method: "PATCH", url: `/api/threads/${t}/resume`, payload: { resumeRelevant: true, starSituation: "상황", skillsTags: ["계획"] } });
    expect(counts(conn)).toEqual(before);
  });

  it("GET fails open to [] for legacy corrupt skills_tags JSON", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "여행", "done");
    conn.sqlite.prepare("UPDATE threads SET skills_tags = ? WHERE id=?").run("{not valid json", t);
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t}` })).json().data;
    expect(detail.resume.skillsTags).toEqual([]);
  });
});
