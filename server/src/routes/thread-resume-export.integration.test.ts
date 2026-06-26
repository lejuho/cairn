import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadResumeExportDataSchema } from "@cairn/shared";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const tempDirs: string[] = [];
function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-rexport-"));
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
  return Number(conn.sqlite.prepare("INSERT INTO threads (name, kind, goal, status) VALUES (?, 'trip', '6월 파리', ?)").run(name, status).lastInsertRowid);
}
async function markResume(conn: SqliteConnection, id: number, payload: Record<string, unknown>) {
  const app = buildServer(conn.db);
  return app.inject({ method: "PATCH", url: `/api/threads/${id}/resume`, payload });
}
function snapshotThreadsRow(conn: SqliteConnection, id: number) {
  return conn.sqlite.prepare("SELECT * FROM threads WHERE id=?").get(id);
}

describe("GET /api/threads/:id/resume-export (cycle-57)", () => {
  it("exports deterministic JSON for a completed resume-relevant thread without DB writes", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리 여행", "done");
    await markResume(conn, t, { resumeRelevant: true, starSituation: "상황", starAction: "행동", starResult: "결과", skillsTags: ["계획", "조율"] });
    const before = snapshotThreadsRow(conn, t);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${t}/resume-export?format=json` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(ThreadResumeExportDataSchema.safeParse(data).success).toBe(true);
    expect(data.format).toBe("json");
    expect(data.json.star.situation).toBe("상황");
    expect(data.json.skills).toEqual(["계획", "조율"]);
    expect(JSON.parse(data.content)).toEqual(data.json);
    expect(snapshotThreadsRow(conn, t)).toEqual(before); // read-only
  });

  it("exports deterministic Markdown", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리 여행", "done");
    await markResume(conn, t, { resumeRelevant: true, starSituation: "상황", skillsTags: ["계획"] });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${t}/resume-export?format=markdown` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.format).toBe("markdown");
    expect(res.json().data.content).toContain("# 파리 여행");
    expect(res.json().data.json).toBeUndefined();
  });

  it("rejects invalid/missing format with 400", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리", "done");
    await markResume(conn, t, { resumeRelevant: true, starSituation: "상황" });
    const app = buildServer(conn.db);
    expect((await app.inject({ method: "GET", url: `/api/threads/${t}/resume-export` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/threads/${t}/resume-export?format=pdf` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/threads/0/resume-export?format=json` })).statusCode).toBe(400);
  });

  it("returns 404 for unknown thread", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    expect((await app.inject({ method: "GET", url: "/api/threads/9999/resume-export?format=json" })).statusCode).toBe(404);
  });

  it("returns 409 THREAD_NOT_DONE for a non-completed thread", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "진행중", "active");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${t}/resume-export?format=json` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("THREAD_NOT_DONE");
  });

  it("returns 409 RESUME_NOT_MARKED when resumeRelevant is not true", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리", "done");
    await markResume(conn, t, { starSituation: "상황" }); // saved text but not marked
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${t}/resume-export?format=json` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESUME_NOT_MARKED");
  });

  it("returns 409 RESUME_EMPTY when marked but no saved STAR fields or skills", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리", "done");
    await markResume(conn, t, { resumeRelevant: true });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${t}/resume-export?format=json` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESUME_EMPTY");
  });

  it("treats whitespace-only skills as empty (RESUME_EMPTY) rather than exporting blank", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리", "done");
    await markResume(conn, t, { resumeRelevant: true });
    // inject a corrupt/blank-only skills_tags directly, no star fields
    conn.sqlite.prepare("UPDATE threads SET skills_tags = ? WHERE id=?").run(JSON.stringify(["   ", ""]), t);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${t}/resume-export?format=json` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESUME_EMPTY");
  });
});
