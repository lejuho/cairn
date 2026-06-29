import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-items-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("GET /api/items", () => {
  let app: FastifyInstance;
  let conn: SqliteConnection;

  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });

  afterEach(() => conn.sqlite.close());

  it("lists active unthreaded events and tasks", async () => {
    conn.sqlite
      .prepare("insert into events (title, source, self_imposed, status) values (?, ?, ?, ?)")
      .run("어딘가에 안 묶인 일정", "cairn", 1, "planned");
    conn.sqlite
      .prepare("insert into events (title, source, self_imposed, status) values (?, ?, ?, ?)")
      .run("끝난 일정", "cairn", 1, "done");
    conn.sqlite
      .prepare("insert into tasks (title, status) values (?, ?)")
      .run("어딘가에 안 묶인 할 일", "todo");
    conn.sqlite
      .prepare("insert into tasks (title, status) values (?, ?)")
      .run("드롭된 할 일", "dropped");

    const res = await app.inject({ method: "GET", url: "/api/items" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { events: Array<{ title: string }>; tasks: Array<{ title: string }> } };

    expect(body.data.events.map((event) => event.title)).toEqual(["어딘가에 안 묶인 일정"]);
    expect(body.data.tasks.map((task) => task.title)).toEqual(["어딘가에 안 묶인 할 일"]);
  });

  it("includes completed rows when scope is all", async () => {
    conn.sqlite
      .prepare("insert into events (title, source, self_imposed, status) values (?, ?, ?, ?)")
      .run("끝난 일정", "cairn", 1, "done");
    conn.sqlite
      .prepare("insert into tasks (title, status) values (?, ?)")
      .run("드롭된 할 일", "dropped");

    const res = await app.inject({ method: "GET", url: "/api/items?scope=all" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { scope: string; events: Array<{ title: string }>; tasks: Array<{ title: string }> } };

    expect(body.data.scope).toBe("all");
    expect(body.data.events[0]?.title).toBe("끝난 일정");
    expect(body.data.tasks[0]?.title).toBe("드롭된 할 일");
  });

  it("rejects invalid query values", async () => {
    const res = await app.inject({ method: "GET", url: "/api/items?limit=201" });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });
});
