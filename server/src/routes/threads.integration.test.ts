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

describe("POST /api/threads/:id/links", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });

  afterEach(() => conn.sqlite.close());

  async function makeThread(name: string): Promise<number> {
    const res = await app.inject({ method: "POST", url: "/api/threads", payload: { name } });
    return res.json().data.id as number;
  }

  it("creates a link and returns 201 with link row", async () => {
    const [a, b] = [await makeThread("A"), await makeThread("B")];
    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${a}/links`,
      payload: { toThreadId: b, kind: "contains" }
    });
    expect(res.statusCode).toBe(201);
    const { link } = res.json().data as { link: { id: number; fromThread: number; toThread: number; kind: string; firmness: string } };
    expect(link.fromThread).toBe(a);
    expect(link.toThread).toBe(b);
    expect(link.kind).toBe("contains");
    expect(link.firmness).toBe("hard");
    expect(link.id).toBeTypeOf("number");
  });

  it("repeat create is idempotent: returns 200, no duplicate row", async () => {
    const [a, b] = [await makeThread("A"), await makeThread("B")];
    const first = await app.inject({
      method: "POST",
      url: `/api/threads/${a}/links`,
      payload: { toThreadId: b, kind: "contains" }
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/threads/${a}/links`,
      payload: { toThreadId: b, kind: "contains" }
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    const rows = conn.sqlite.prepare("SELECT count(*) as cnt FROM thread_links").get() as { cnt: number };
    expect(rows.cnt).toBe(1);
  });

  it("self-link returns 400 VALIDATION_ERROR", async () => {
    const a = await makeThread("A");
    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${a}/links`,
      payload: { toThreadId: a, kind: "contains" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("SELF_LINK");
  });

  it("missing thread returns 404 NOT_FOUND", async () => {
    const a = await makeThread("A");
    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${a}/links`,
      payload: { toThreadId: 9999, kind: "blocks" }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    const rows = conn.sqlite.prepare("SELECT count(*) as cnt FROM thread_links").get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  it("invalid kind returns 400", async () => {
    const [a, b] = [await makeThread("A"), await makeThread("B")];
    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${a}/links`,
      payload: { toThreadId: b, kind: "unknown_kind" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("contains cycle returns 409 CONTAINS_CYCLE without write", async () => {
    const [a, b, c] = [await makeThread("A"), await makeThread("B"), await makeThread("C")];
    await app.inject({ method: "POST", url: `/api/threads/${a}/links`, payload: { toThreadId: b, kind: "contains" } });
    await app.inject({ method: "POST", url: `/api/threads/${b}/links`, payload: { toThreadId: c, kind: "contains" } });
    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${c}/links`,
      payload: { toThreadId: a, kind: "contains" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONTAINS_CYCLE");
    const rows = conn.sqlite.prepare("SELECT count(*) as cnt FROM thread_links").get() as { cnt: number };
    expect(rows.cnt).toBe(2);
  });

  it("hard contains parent conflict returns 409 CONTAINS_PARENT_CONFLICT", async () => {
    const [a, b, c] = [await makeThread("A"), await makeThread("B"), await makeThread("C")];
    await app.inject({ method: "POST", url: `/api/threads/${a}/links`, payload: { toThreadId: c, kind: "contains" } });
    const res = await app.inject({
      method: "POST",
      url: `/api/threads/${b}/links`,
      payload: { toThreadId: c, kind: "contains" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONTAINS_PARENT_CONFLICT");
    const rows = conn.sqlite.prepare("SELECT count(*) as cnt FROM thread_links").get() as { cnt: number };
    expect(rows.cnt).toBe(1);
  });
});

describe("DELETE /api/threads/:id/links/:linkId", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });

  afterEach(() => conn.sqlite.close());

  async function makeThread(name: string): Promise<number> {
    const res = await app.inject({ method: "POST", url: "/api/threads", payload: { name } });
    return res.json().data.id as number;
  }

  it("deletes outgoing link and removes only that row", async () => {
    const [a, b] = [await makeThread("A"), await makeThread("B")];
    const linkRes = await app.inject({
      method: "POST",
      url: `/api/threads/${a}/links`,
      payload: { toThreadId: b, kind: "blocks" }
    });
    const linkId = linkRes.json().data.link.id as number;

    const del = await app.inject({ method: "DELETE", url: `/api/threads/${a}/links/${linkId}` });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);
    const rows = conn.sqlite.prepare("SELECT count(*) as cnt FROM thread_links").get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  it("cannot delete incoming link from target thread — returns 404", async () => {
    const [a, b] = [await makeThread("A"), await makeThread("B")];
    const linkRes = await app.inject({
      method: "POST",
      url: `/api/threads/${a}/links`,
      payload: { toThreadId: b, kind: "feeds" }
    });
    const linkId = linkRes.json().data.link.id as number;

    // Attempt to delete from b's perspective (b is the toThread, not fromThread)
    const del = await app.inject({ method: "DELETE", url: `/api/threads/${b}/links/${linkId}` });
    expect(del.statusCode).toBe(404);
    const rows = conn.sqlite.prepare("SELECT count(*) as cnt FROM thread_links").get() as { cnt: number };
    expect(rows.cnt).toBe(1);
  });

  it("returns 404 for non-existent link", async () => {
    const a = await makeThread("A");
    const del = await app.inject({ method: "DELETE", url: `/api/threads/${a}/links/9999` });
    expect(del.statusCode).toBe(404);
  });
});

describe("Thread relation counts and peer views", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });

  afterEach(() => conn.sqlite.close());

  async function makeThread(name: string): Promise<number> {
    const res = await app.inject({ method: "POST", url: "/api/threads", payload: { name } });
    return res.json().data.id as number;
  }

  it("GET /api/threads includes relationCounts (0/0 when no links)", async () => {
    const a = await makeThread("A");
    const res = await app.inject({ method: "GET", url: "/api/threads" });
    const summaries = res.json().data as Array<{ thread: { id: number }; relationCounts: { incoming: number; outgoing: number } }>;
    const s = summaries.find((x) => x.thread.id === a)!;
    expect(s.relationCounts.incoming).toBe(0);
    expect(s.relationCounts.outgoing).toBe(0);
  });

  it("GET /api/threads reflects correct incoming/outgoing counts after link creation", async () => {
    const [a, b, c] = [await makeThread("A"), await makeThread("B"), await makeThread("C")];
    await app.inject({ method: "POST", url: `/api/threads/${a}/links`, payload: { toThreadId: b, kind: "contains" } });
    await app.inject({ method: "POST", url: `/api/threads/${a}/links`, payload: { toThreadId: c, kind: "blocks" } });

    const res = await app.inject({ method: "GET", url: "/api/threads" });
    const summaries = res.json().data as Array<{ thread: { id: number }; relationCounts: { incoming: number; outgoing: number } }>;
    const sa = summaries.find((x) => x.thread.id === a)!;
    const sb = summaries.find((x) => x.thread.id === b)!;
    expect(sa.relationCounts.outgoing).toBe(2);
    expect(sa.relationCounts.incoming).toBe(0);
    expect(sb.relationCounts.incoming).toBe(1);
    expect(sb.relationCounts.outgoing).toBe(0);
  });

  it("GET /api/threads/:id detail includes relations with peer names", async () => {
    const [a, b] = [await makeThread("Alpha"), await makeThread("Beta")];
    await app.inject({ method: "POST", url: `/api/threads/${a}/links`, payload: { toThreadId: b, kind: "feeds" } });

    const res = await app.inject({ method: "GET", url: `/api/threads/${a}` });
    expect(res.statusCode).toBe(200);
    const { relations } = res.json().data as {
      relations: { incoming: Array<unknown>; outgoing: Array<{ fromThread: { name: string }; toThread: { name: string }; kind: string }> }
    };
    expect(relations.outgoing).toHaveLength(1);
    expect(relations.outgoing[0]!.fromThread.name).toBe("Alpha");
    expect(relations.outgoing[0]!.toThread.name).toBe("Beta");
    expect(relations.outgoing[0]!.kind).toBe("feeds");
    expect(relations.incoming).toHaveLength(0);
  });

  it("incoming link visible from target detail", async () => {
    const [a, b] = [await makeThread("Alpha"), await makeThread("Beta")];
    await app.inject({ method: "POST", url: `/api/threads/${a}/links`, payload: { toThreadId: b, kind: "contains" } });

    const res = await app.inject({ method: "GET", url: `/api/threads/${b}` });
    const { relations } = res.json().data as {
      relations: { incoming: Array<{ fromThread: { name: string } }>; outgoing: Array<unknown> }
    };
    expect(relations.incoming).toHaveLength(1);
    expect(relations.incoming[0]!.fromThread.name).toBe("Alpha");
    expect(relations.outgoing).toHaveLength(0);
  });

  it("contains cycle: long chain A→B→C, reject C→A", async () => {
    const [a, b, c] = [await makeThread("A"), await makeThread("B"), await makeThread("C")];
    await app.inject({ method: "POST", url: `/api/threads/${a}/links`, payload: { toThreadId: b, kind: "contains" } });
    await app.inject({ method: "POST", url: `/api/threads/${b}/links`, payload: { toThreadId: c, kind: "contains" } });

    // A→D is fine (unrelated branch)
    const d = await makeThread("D");
    const ok = await app.inject({ method: "POST", url: `/api/threads/${a}/links`, payload: { toThreadId: d, kind: "contains" } });
    expect(ok.statusCode).toBe(201);

    // C→A creates cycle → 409
    const cycle = await app.inject({ method: "POST", url: `/api/threads/${c}/links`, payload: { toThreadId: a, kind: "contains" } });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().error.code).toBe("CONTAINS_CYCLE");
  });
});

describe("POST /api/events + /api/tasks with threadId linkage", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });

  afterEach(() => conn.sqlite.close());

  it("POST /api/events with threadId persists link and appears in thread detail", async () => {
    const threadRes = await app.inject({
      method: "POST", url: "/api/threads", payload: { name: "Work" }
    });
    const tid = threadRes.json().data.id as number;

    await app.inject({
      method: "POST", url: "/api/events",
      payload: { title: "Kickoff", start: "2026-06-20T10:00:00+00:00", end: "2026-06-20T11:00:00+00:00", threadId: tid }
    });

    const detail = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    const { events } = detail.json().data as { events: Array<{ title: string }> };
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Kickoff");
  });

  it("POST /api/tasks with threadId persists link and appears in thread detail", async () => {
    const threadRes = await app.inject({
      method: "POST", url: "/api/threads", payload: { name: "Work" }
    });
    const tid = threadRes.json().data.id as number;

    await app.inject({
      method: "POST", url: "/api/tasks",
      payload: { title: "Research", estMinutes: 30, threadId: tid }
    });

    const detail = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    const { tasks } = detail.json().data as { tasks: Array<{ title: string }> };
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Research");
  });

  it("POST /api/events without threadId creates unlinked event", async () => {
    const threadRes = await app.inject({
      method: "POST", url: "/api/threads", payload: { name: "Empty" }
    });
    const tid = threadRes.json().data.id as number;

    await app.inject({
      method: "POST", url: "/api/events",
      payload: { title: "Orphan", start: "2026-06-20T10:00:00+00:00", end: "2026-06-20T11:00:00+00:00" }
    });

    const detail = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    expect(detail.json().data.events).toHaveLength(0);
  });
});
