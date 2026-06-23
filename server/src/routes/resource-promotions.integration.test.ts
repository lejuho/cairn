import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildCandidateKey } from "../services/resource-promotions.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-promotions-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertThread(conn: SqliteConnection, name: string, goal?: string): number {
  const res = conn.sqlite.prepare(`INSERT INTO threads (name, goal) VALUES (?, ?)`).run(name, goal ?? null);
  return Number(res.lastInsertRowid);
}

function insertEvent(conn: SqliteConnection, threadId: number, title: string, location?: string): number {
  const res = conn.sqlite
    .prepare(`INSERT INTO events (title, thread_id, location, source, self_imposed, status) VALUES (?, ?, ?, 'cairn', 1, 'planned')`)
    .run(title, threadId, location ?? null);
  return Number(res.lastInsertRowid);
}

function insertTask(conn: SqliteConnection, threadId: number, title: string, context?: string): number {
  const res = conn.sqlite
    .prepare(`INSERT INTO tasks (title, thread_id, status, context) VALUES (?, ?, 'todo', ?)`)
    .run(title, threadId, context ?? null);
  return Number(res.lastInsertRowid);
}

function insertPerson(conn: SqliteConnection, name: string): number {
  const res = conn.sqlite.prepare(`INSERT INTO people (name) VALUES (?)`).run(name);
  return Number(res.lastInsertRowid);
}

describe("GET /api/resources/promotion-suggestions", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("returns empty list when no repeated mentions", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "프로젝트");
    insertEvent(conn, threadId, "item: 노트북");
    const res = await app.inject({ method: "GET", url: "/api/resources/promotion-suggestions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.suggestions).toHaveLength(0);
  });

  it("returns suggestion when same name+kind appears in event and task", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "발표 준비");
    insertEvent(conn, threadId, "item: 노트북 준비");
    insertTask(conn, threadId, "확인", "item: 노트북 준비");
    const res = await app.inject({ method: "GET", url: "/api/resources/promotion-suggestions" });
    expect(res.statusCode).toBe(200);
    const { suggestions } = res.json().data;
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].name).toBe("노트북 준비");
    expect(suggestions[0].occurrenceCount).toBe(2);
  });

  it("returns suggestion spanning thread+event", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드", "지식: 머신러닝");
    insertEvent(conn, threadId, "지식: 머신러닝");
    const res = await app.inject({ method: "GET", url: "/api/resources/promotion-suggestions" });
    const { suggestions } = res.json().data;
    expect(suggestions[0].kind).toBe("knowledge");
    expect(suggestions[0].occurrences.map((o: { targetType: string }) => o.targetType).sort()).toEqual(["event", "thread"]);
  });

  it("returns suggestion spanning task+task", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    insertTask(conn, threadId, "task A", "item: 충전기");
    insertTask(conn, threadId, "task B", "item: 충전기");
    const res = await app.inject({ method: "GET", url: "/api/resources/promotion-suggestions" });
    expect(res.json().data.suggestions[0].occurrenceCount).toBe(2);
  });

  it("scopes to threadId when provided", async () => {
    const app = buildServer(conn.db);
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEvent(conn, t1, "item: 노트북");
    insertEvent(conn, t2, "item: 노트북");
    // Global: 2 nodes → suggestion; scoped to t1: only 1 node → no suggestion
    const globalRes = await app.inject({ method: "GET", url: "/api/resources/promotion-suggestions" });
    expect(globalRes.json().data.suggestions).toHaveLength(1);
    const scopedRes = await app.inject({ method: "GET", url: `/api/resources/promotion-suggestions?threadId=${t1}` });
    expect(scopedRes.json().data.suggestions).toHaveLength(0);
  });

  it("returns 400 for non-integer threadId", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/resources/promotion-suggestions?threadId=abc" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for missing threadId", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/resources/promotion-suggestions?threadId=9999" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/resources/promotion-suggestions/approve", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  function makeSuggestionBody(conn: SqliteConnection) {
    const threadId = insertThread(conn, "발표");
    const eventId = insertEvent(conn, threadId, "item: 마이크");
    const taskId = insertTask(conn, threadId, "준비", "item: 마이크");
    const occurrences = [
      { targetType: "event" as const, targetId: eventId },
      { targetType: "task" as const, targetId: taskId }
    ];
    const candidateKey = buildCandidateKey("마이크", "item", occurrences);
    return { candidateKey, name: "마이크", kind: "item" as const, occurrences };
  }

  it("creates a resource and links in one transaction", async () => {
    const app = buildServer(conn.db);
    const body = makeSuggestionBody(conn);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/promotion-suggestions/approve",
      payload: body
    });
    expect(res.statusCode).toBe(201);
    const { resource, links, reusedResource } = res.json().data;
    expect(resource.name).toBe("마이크");
    expect(resource.kind).toBe("item");
    expect(links).toHaveLength(2);
    expect(reusedResource).toBe(false);
  });

  it("reuses same-name/same-kind resource", async () => {
    const app = buildServer(conn.db);
    // Pre-create the resource
    await app.inject({
      method: "POST",
      url: "/api/resources",
      payload: { name: "마이크", kind: "item" }
    });
    const body = makeSuggestionBody(conn);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/promotion-suggestions/approve",
      payload: body
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.reusedResource).toBe(true);
  });

  it("rejects stale candidateKey", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const eventId = insertEvent(conn, threadId, "item: 마이크");
    const taskId = insertTask(conn, threadId, "준비", "item: 마이크");

    // Use wrong occurrence set for key (stale)
    const staleOccurrences = [
      { targetType: "event" as const, targetId: eventId },
      { targetType: "task" as const, targetId: taskId + 100 } // non-existent
    ];
    const staleKey = buildCandidateKey("마이크", "item", staleOccurrences);

    const realOccurrences = [
      { targetType: "event" as const, targetId: eventId },
      { targetType: "task" as const, targetId: taskId }
    ];

    const res = await app.inject({
      method: "POST",
      url: "/api/resources/promotion-suggestions/approve",
      payload: { candidateKey: staleKey, name: "마이크", kind: "item", occurrences: realOccurrences }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("PROMOTION_STALE");
  });

  it("returns PROMOTION_NOT_ELIGIBLE when candidate no longer exists", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const eventId = insertEvent(conn, threadId, "item: 마이크");
    const taskId = insertTask(conn, threadId, "준비", "item: 마이크");
    const occurrences = [
      { targetType: "event" as const, targetId: eventId },
      { targetType: "task" as const, targetId: taskId }
    ];
    const key = buildCandidateKey("존재하지않음", "item", occurrences);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/promotion-suggestions/approve",
      payload: { candidateKey: key, name: "존재하지않음", kind: "item", occurrences }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("PROMOTION_NOT_ELIGIBLE");
  });

  it("returns SOURCE_PERSON_NOT_FOUND for missing source person", async () => {
    const app = buildServer(conn.db);
    const body = { ...makeSuggestionBody(conn), sourcePersonId: 9999 };
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/promotion-suggestions/approve",
      payload: body
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("SOURCE_PERSON_NOT_FOUND");
  });

  it("accepts valid sourcePersonId", async () => {
    const app = buildServer(conn.db);
    const personId = insertPerson(conn, "Alice");
    const body = { ...makeSuggestionBody(conn), sourcePersonId: personId };
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/promotion-suggestions/approve",
      payload: body
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.resource.sourcePersonId).toBe(personId);
  });

  it("duplicate approval does not create duplicate links", async () => {
    const app = buildServer(conn.db);
    const body = makeSuggestionBody(conn);
    await app.inject({ method: "POST", url: "/api/resources/promotion-suggestions/approve", payload: body });
    // Second approval — suggestions are now suppressed (all linked), so stale
    const res2 = await app.inject({ method: "POST", url: "/api/resources/promotion-suggestions/approve", payload: body });
    // Stale because all occurrences are now linked → suppressed from recomputed set
    expect([201, 409]).toContain(res2.statusCode);
    // Verify DB: only 2 link rows exist
    const count = conn.sqlite.prepare("SELECT count(*) as c FROM resource_links").get() as { c: number };
    expect(count.c).toBe(2);
  });

  it("returns 400 for body with fewer than 2 occurrences", async () => {
    const app = buildServer(conn.db);
    const threadId = insertThread(conn, "스레드");
    const eventId = insertEvent(conn, threadId, "item: 마이크");
    const occurrences = [{ targetType: "event" as const, targetId: eventId }];
    const key = buildCandidateKey("마이크", "item", occurrences);
    const res = await app.inject({
      method: "POST",
      url: "/api/resources/promotion-suggestions/approve",
      payload: { candidateKey: key, name: "마이크", kind: "item", occurrences }
    });
    expect(res.statusCode).toBe(400);
  });
});
