import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-rel-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

// ---------- Insert helpers ----------

function insertPerson(conn: SqliteConnection, name: string): number {
  const r = conn.sqlite.prepare(`INSERT INTO people (name) VALUES (?)`).run(name);
  return Number(r.lastInsertRowid);
}

function insertThread(conn: SqliteConnection, name: string): number {
  const r = conn.sqlite.prepare(`INSERT INTO threads (name) VALUES (?)`).run(name);
  return Number(r.lastInsertRowid);
}

function insertEvent(conn: SqliteConnection, threadId: number, title: string): number {
  const r = conn.sqlite
    .prepare(`INSERT INTO events (thread_id, title, source, self_imposed) VALUES (?, ?, 'cairn', 1)`)
    .run(threadId, title);
  return Number(r.lastInsertRowid);
}

function insertTask(conn: SqliteConnection, threadId: number, title: string): number {
  const r = conn.sqlite
    .prepare(`INSERT INTO tasks (thread_id, title) VALUES (?, ?)`)
    .run(threadId, title);
  return Number(r.lastInsertRowid);
}

function insertResource(
  conn: SqliteConnection,
  name: string,
  kind = "item",
  sourcePersonId: number | null = null
): number {
  const r = conn.sqlite
    .prepare(`INSERT INTO resources (name, kind, source_person_id) VALUES (?, ?, ?)`)
    .run(name, kind, sourcePersonId);
  return Number(r.lastInsertRowid);
}

function insertResourceLink(
  conn: SqliteConnection,
  resourceId: number,
  targetType: "event" | "task" | "thread",
  targetId: number,
  firmness = "soft",
  reason: string | null = null
): void {
  conn.sqlite
    .prepare(
      `INSERT INTO resource_links (resource_id, target_type, target_id, firmness, reason)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(resourceId, targetType, targetId, firmness, reason);
}

function insertEventPerson(conn: SqliteConnection, eventId: number, personId: number): void {
  conn.sqlite.prepare(`INSERT INTO event_people (event_id, person_id) VALUES (?, ?)`).run(eventId, personId);
}

// ---------- Helpers ----------

function egoGet(conn: SqliteConnection, query: Record<string, string | number>) {
  const app = buildServer(conn.db);
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
  return app.inject({ method: "GET", url: `/api/relations/ego?${qs}` });
}

// ---------- Tests ----------

describe("GET /api/relations/ego — validation", () => {
  it("returns 400 for missing targetType", async () => {
    const conn = makeTestDb();
    const res = await egoGet(conn, { targetId: "1" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid targetType", async () => {
    const conn = makeTestDb();
    const res = await egoGet(conn, { targetType: "task", targetId: "1" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for limit out of range", async () => {
    const conn = makeTestDb();
    const res = await egoGet(conn, { targetType: "resource", targetId: "1", limit: "3" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent resource", async () => {
    const conn = makeTestDb();
    const res = await egoGet(conn, { targetType: "resource", targetId: "999" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for non-existent person", async () => {
    const conn = makeTestDb();
    const res = await egoGet(conn, { targetType: "person", targetId: "999" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/relations/ego — resource center", () => {
  it("returns center node with no neighbors for isolated resource", async () => {
    const conn = makeTestDb();
    const rid = insertResource(conn, "노트북");
    const res = await egoGet(conn, { targetType: "resource", targetId: rid });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.data.center.id).toBe(`resource:${rid}`);
    expect(body.data.center.label).toBe("노트북");
    expect(body.data.nodes).toHaveLength(1);
    expect(body.data.edges).toHaveLength(0);
    expect(body.data.truncated).toBe(false);
  });

  it("includes source_person edge when resource has sourcePersonId", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "Alice");
    const rid = insertResource(conn, "노트북", "item", pid);
    const res = await egoGet(conn, { targetType: "resource", targetId: rid });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.nodes).toHaveLength(2);
    const personNode = body.data.nodes.find((n: { type: string }) => n.type === "person");
    expect(personNode).toBeDefined();
    expect(personNode.label).toBe("Alice");
    expect(personNode.id).toBe(`person:${pid}`);
    const edge = body.data.edges.find((e: { kind: string }) => e.kind === "source_person");
    expect(edge).toBeDefined();
    expect(edge.firmness).toBe("hard");
  });

  it("includes event neighbor from resource_links with firmness and reason", async () => {
    const conn = makeTestDb();
    const tid = insertThread(conn, "발표 준비");
    const eid = insertEvent(conn, tid, "발표 리허설");
    const rid = insertResource(conn, "슬라이드");
    insertResourceLink(conn, rid, "event", eid, "tentative", "발표 때 사용");
    const res = await egoGet(conn, { targetType: "resource", targetId: rid });
    const body = JSON.parse(res.payload);
    expect(body.data.nodes.some((n: { id: string }) => n.id === `event:${eid}`)).toBe(true);
    const eventNode = body.data.nodes.find((n: { id: string }) => n.id === `event:${eid}`);
    expect(eventNode.sublabel).toBe("발표 준비");
    const edge = body.data.edges.find((e: { kind: string }) => e.kind === "resource_link");
    expect(edge.firmness).toBe("tentative");
    expect(edge.reason).toBe("발표 때 사용");
  });

  it("includes task neighbor with sublabel from parent thread", async () => {
    const conn = makeTestDb();
    const tid = insertThread(conn, "출장 준비");
    const taskId = insertTask(conn, tid, "짐 꾸리기");
    const rid = insertResource(conn, "여행 가방");
    insertResourceLink(conn, rid, "task", taskId, "soft");
    const res = await egoGet(conn, { targetType: "resource", targetId: rid });
    const body = JSON.parse(res.payload);
    const taskNode = body.data.nodes.find((n: { type: string }) => n.type === "task");
    expect(taskNode).toBeDefined();
    expect(taskNode.sublabel).toBe("출장 준비");
  });

  it("includes thread neighbor", async () => {
    const conn = makeTestDb();
    const tid = insertThread(conn, "발표 준비");
    const rid = insertResource(conn, "자료");
    insertResourceLink(conn, rid, "thread", tid, "soft");
    const res = await egoGet(conn, { targetType: "resource", targetId: rid });
    const body = JSON.parse(res.payload);
    const threadNode = body.data.nodes.find((n: { type: string }) => n.type === "thread");
    expect(threadNode).toBeDefined();
    expect(threadNode.label).toBe("발표 준비");
    expect(threadNode.href).toBe(`/threads/${tid}`);
  });

  it("caps neighbors at limit-1 and sets truncated=true", async () => {
    const conn = makeTestDb();
    const tid = insertThread(conn, "T");
    const rid = insertResource(conn, "노트북");
    for (let i = 0; i < 8; i++) {
      const eid = insertEvent(conn, tid, `Event ${i}`);
      insertResourceLink(conn, rid, "event", eid, "soft");
    }
    const res = await egoGet(conn, { targetType: "resource", targetId: rid, limit: "5" });
    const body = JSON.parse(res.payload);
    expect(body.data.nodes).toHaveLength(5); // center + 4
    expect(body.data.truncated).toBe(true);
  });

  it("edges only reference kept nodes when truncated", async () => {
    const conn = makeTestDb();
    const tid = insertThread(conn, "T");
    const rid = insertResource(conn, "노트북");
    const eids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const eid = insertEvent(conn, tid, `Event ${i}`);
      eids.push(eid);
      insertResourceLink(conn, rid, "event", eid, "soft");
    }
    const res = await egoGet(conn, { targetType: "resource", targetId: rid, limit: "5" });
    const body = JSON.parse(res.payload);
    const keptIds = new Set(body.data.nodes.map((n: { id: string }) => n.id));
    for (const edge of body.data.edges as { from: string; to: string }[]) {
      expect(keptIds.has(edge.from)).toBe(true);
      expect(keptIds.has(edge.to)).toBe(true);
    }
  });
});

describe("GET /api/relations/ego — person center", () => {
  it("returns center node with no neighbors for isolated person", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "Bob");
    const res = await egoGet(conn, { targetType: "person", targetId: pid });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.center.id).toBe(`person:${pid}`);
    expect(body.data.nodes).toHaveLength(1);
    expect(body.data.edges).toHaveLength(0);
    expect(body.data.truncated).toBe(false);
  });

  it("includes resources where source_person_id = person", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "Alice");
    insertResource(conn, "노트북", "item", pid);
    insertResource(conn, "지식 문서", "knowledge", pid);
    const res = await egoGet(conn, { targetType: "person", targetId: pid });
    const body = JSON.parse(res.payload);
    const resourceNodes = body.data.nodes.filter((n: { type: string }) => n.type === "resource");
    expect(resourceNodes).toHaveLength(2);
  });

  it("includes events via event_people", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "Charlie");
    const tid = insertThread(conn, "회의");
    const eid = insertEvent(conn, tid, "주간 회의");
    insertEventPerson(conn, eid, pid);
    const res = await egoGet(conn, { targetType: "person", targetId: pid });
    const body = JSON.parse(res.payload);
    const eventNode = body.data.nodes.find((n: { type: string }) => n.type === "event");
    expect(eventNode).toBeDefined();
    expect(eventNode.label).toBe("주간 회의");
    expect(eventNode.sublabel).toBe("회의");
    const edge = body.data.edges.find((e: { kind: string }) => e.kind === "event_people");
    expect(edge).toBeDefined();
    expect(edge.firmness).toBe("soft");
  });

  it("caps and truncates in person center", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "Dave");
    const tid = insertThread(conn, "T");
    for (let i = 0; i < 8; i++) {
      const eid = insertEvent(conn, tid, `E${i}`);
      insertEventPerson(conn, eid, pid);
    }
    const res = await egoGet(conn, { targetType: "person", targetId: pid, limit: "5" });
    const body = JSON.parse(res.payload);
    expect(body.data.nodes).toHaveLength(5);
    expect(body.data.truncated).toBe(true);
  });
});

describe("GET /api/relations/ego — read-only (no side effects)", () => {
  it("repeated calls return identical result (deterministic)", async () => {
    const conn = makeTestDb();
    const pid = insertPerson(conn, "Eve");
    const rid = insertResource(conn, "노트북", "item", pid);
    const tid = insertThread(conn, "T");
    const eid = insertEvent(conn, tid, "발표");
    insertResourceLink(conn, rid, "event", eid, "soft");
    const qs = { targetType: "resource", targetId: rid };
    const app = buildServer(conn.db);
    const r1 = await app.inject({ method: "GET", url: `/api/relations/ego?targetType=resource&targetId=${rid}` });
    const r2 = await app.inject({ method: "GET", url: `/api/relations/ego?targetType=resource&targetId=${rid}` });
    expect(r1.payload).toBe(r2.payload);
    void qs; // suppress unused warning
  });
});
