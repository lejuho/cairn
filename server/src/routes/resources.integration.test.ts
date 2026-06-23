import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-resources-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertPerson(conn: SqliteConnection, name: string): number {
  const res = conn.sqlite.prepare(`INSERT INTO people (name) VALUES (?)`).run(name);
  return Number(res.lastInsertRowid);
}

function insertThread(conn: SqliteConnection, name: string): number {
  const res = conn.sqlite.prepare(`INSERT INTO threads (name) VALUES (?)`).run(name);
  return Number(res.lastInsertRowid);
}

function insertEvent(conn: SqliteConnection, threadId: number, title = "이벤트"): number {
  const res = conn.sqlite
    .prepare(`INSERT INTO events (title, thread_id, source, self_imposed, status) VALUES (?, ?, 'cairn', 1, 'planned')`)
    .run(title, threadId);
  return Number(res.lastInsertRowid);
}

function insertTask(conn: SqliteConnection, threadId: number, title = "태스크"): number {
  const res = conn.sqlite
    .prepare(`INSERT INTO tasks (title, thread_id, status) VALUES (?, ?, 'todo')`)
    .run(title, threadId);
  return Number(res.lastInsertRowid);
}

describe("POST /api/resources", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("creates a resource successfully", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "노트북", kind: "item" }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.resource.name).toBe("노트북");
    expect(body.data.resource.kind).toBe("item");
    expect(body.data.resource.id).toBeGreaterThan(0);
  });

  it("creates a knowledge resource with note and sourcePersonId", async () => {
    const app = buildServer(conn.db);
    const personId = insertPerson(conn, "Alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "알고리즘 노트", kind: "knowledge", sourcePersonId: personId, note: "수업 자료" }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.resource.sourcePersonId).toBe(personId);
    expect(body.data.resource.note).toBe("수업 자료");
  });

  it("rejects missing source person", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "X", kind: "item", sourcePersonId: 9999 }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("SOURCE_PERSON_NOT_FOUND");
  });

  it("rejects empty name", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "", kind: "item" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid kind", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "X", kind: "document" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects injected score field", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "X", kind: "item", score: 99 }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/resources", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("returns empty list when no resources", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/resources" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.resources).toEqual([]);
  });

  it("returns all resources sorted by name asc", async () => {
    const app = buildServer(conn.db);
    await app.inject({ method: "POST", url: "/api/resources", payload: { name: "충전기", kind: "item" } });
    await app.inject({ method: "POST", url: "/api/resources", payload: { name: "노트북", kind: "item" } });
    const res = await app.inject({ method: "GET", url: "/api/resources" });
    const names = res.json().data.resources.map((r: { name: string }) => r.name);
    expect(names).toEqual(["노트북", "충전기"]);
  });
});

describe("POST /api/resources/:id/links", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  async function createResource(app: ReturnType<typeof buildServer>, name = "노트북", kind = "item") {
    const res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name, kind }
    });
    return res.json().data.resource.id as number;
  }

  it("creates an event link successfully", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const eventId = insertEvent(conn, threadId);
    const resourceId = await createResource(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "event", targetId: eventId, firmness: "hard", reason: "발표라 필요" }
    });
    expect(res.statusCode).toBe(201);
    const link = res.json().data.link;
    expect(link.targetType).toBe("event");
    expect(link.targetId).toBe(eventId);
    expect(link.firmness).toBe("hard");
    expect(link.reason).toBe("발표라 필요");
  });

  it("creates a task link successfully", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const taskId = insertTask(conn, threadId);
    const resourceId = await createResource(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "task", targetId: taskId }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.link.targetType).toBe("task");
    expect(res.json().data.link.firmness).toBe("soft");
  });

  it("creates a thread link successfully", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const resourceId = await createResource(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "thread", targetId: threadId }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.link.targetType).toBe("thread");
  });

  it("returns existing link idempotently on duplicate", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const eventId = insertEvent(conn, threadId);
    const resourceId = await createResource(app);

    const first = await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "event", targetId: eventId, firmness: "soft" }
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "event", targetId: eventId, firmness: "hard" }
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().data.link.id).toBe(second.json().data.link.id);
    // first-write wins — firmness stays "soft"
    expect(second.json().data.link.firmness).toBe("soft");
  });

  it("returns 404 for missing resource", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const eventId = insertEvent(conn, threadId);
    const res = await app.inject({
      method: "POST",
      url: `/api/resources/9999/links`,
      payload: { targetType: "event", targetId: eventId }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for missing event target", async () => {
    const app = buildServer(conn.db);
    const resourceId = await createResource(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "event", targetId: 9999 }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TARGET_NOT_FOUND");
  });

  it("returns 404 for missing task target", async () => {
    const app = buildServer(conn.db);
    const resourceId = await createResource(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "task", targetId: 9999 }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TARGET_NOT_FOUND");
  });

  it("returns 404 for missing thread target", async () => {
    const app = buildServer(conn.db);
    const resourceId = await createResource(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "thread", targetId: 9999 }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TARGET_NOT_FOUND");
  });
});

describe("GET /api/threads/:id/resource-focus", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("returns empty resources for thread with no links", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/resource-focus`
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.threadId).toBe(threadId);
    expect(body.data.resources).toEqual([]);
  });

  it("returns 404 for missing thread", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/9999/resource-focus`
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns resources linked to thread, events, and tasks", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "발표 스레드");
    const eventId = insertEvent(conn, threadId, "발표 이벤트");
    const taskId = insertTask(conn, threadId, "준비 태스크");

    const r1Res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "노트북", kind: "item" }
    });
    const resourceId = r1Res.json().data.resource.id as number;

    await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "thread", targetId: threadId, firmness: "soft" }
    });
    await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "event", targetId: eventId, firmness: "hard" }
    });
    await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "task", targetId: taskId, firmness: "tentative" }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/resource-focus`
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.resources).toHaveLength(1);
    const item = body.data.resources[0];
    expect(item.resource.name).toBe("노트북");
    expect(item.links).toHaveLength(3);

    const linkTargetTypes = item.links.map((l: { targetType: string }) => l.targetType).sort();
    expect(linkTargetTypes).toEqual(["event", "task", "thread"]);
  });

  it("excludes links from a different thread", async () => {
    const app = buildServer(conn.db);
    const threadA = insertThread(conn, "A 스레드");
    const threadB = insertThread(conn, "B 스레드");
    const eventB = insertEvent(conn, threadB, "B 이벤트");

    const r1Res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "충전기", kind: "item" }
    });
    const resourceId = r1Res.json().data.resource.id as number;

    // Link only to thread B's event
    await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "event", targetId: eventB, firmness: "soft" }
    });

    // Query thread A — should return no resources
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadA}/resource-focus`
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.resources).toEqual([]);
  });

  it("resource linked to thread itself and one task shows both links", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const taskId = insertTask(conn, threadId, "태스크");

    const r1Res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "레퍼런스", kind: "knowledge" }
    });
    const resourceId = r1Res.json().data.resource.id as number;

    await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "thread", targetId: threadId }
    });
    await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "task", targetId: taskId }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/resource-focus`
    });
    const body = res.json();
    expect(body.data.resources).toHaveLength(1);
    expect(body.data.resources[0].links).toHaveLength(2);
  });

  it("sourcePerson included when present", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const personId = insertPerson(conn, "Alice");

    const r1Res = await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "레퍼런스", kind: "knowledge", sourcePersonId: personId }
    });
    const resourceId = r1Res.json().data.resource.id as number;

    await app.inject({
      method: "POST",
      url: `/api/resources/${resourceId}/links`,
      payload: { targetType: "thread", targetId: threadId }
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${threadId}/resource-focus`
    });
    const item = res.json().data.resources[0];
    expect(item.sourcePerson).toEqual({ id: personId, name: "Alice" });
  });
});
