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
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    const rows = conn.sqlite.prepare("SELECT count(*) as cnt FROM thread_links").get() as { cnt: number };
    expect(rows.cnt).toBe(0);
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

describe("GET /api/threads/:id — rollup (FR-THR-10 Rollup A)", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;
  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });
  afterEach(() => conn.sqlite.close());

  async function createThread(name: string) {
    const res = await app.inject({ method: "POST", url: "/api/threads", payload: { name } });
    return res.json().data.id as number;
  }

  async function linkThreads(fromId: number, toId: number, kind = "contains", firmness = "hard") {
    return app.inject({ method: "POST", url: `/api/threads/${fromId}/links`, payload: { toThreadId: toId, kind, firmness } });
  }

  it("returns empty rollup for a thread with no hard contains children", async () => {
    const tid = await createThread("Alone");
    const res = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    const rollup = res.json().data.rollup;
    expect(rollup.contains.childCount).toBe(0);
    expect(rollup.contains.descendantCount).toBe(0);
    expect(rollup.children).toHaveLength(0);
    expect(rollup.warnings).toHaveLength(0);
  });

  it("aggregates direct and contains progress from parent→child→grandchild chain", async () => {
    const parent = await createThread("Parent");
    const child = await createThread("Child");
    const grand = await createThread("Grandchild");
    await linkThreads(parent, child);
    await linkThreads(child, grand);

    // Add an event to grandchild, then mark it done
    const grandEvRes = await app.inject({ method: "POST", url: "/api/events", payload: { title: "Grand event", threadId: grand, start: "2026-06-21T09:00:00+09:00", end: "2026-06-21T11:00:00+09:00" } });
    const grandEvId = grandEvRes.json().data.id as number;
    await app.inject({ method: "PATCH", url: `/api/events/${grandEvId}/status`, payload: { status: "done" } });

    // Add a planned event to parent (direct)
    await app.inject({ method: "POST", url: "/api/events", payload: { title: "Parent event", threadId: parent, start: "2026-06-21T13:00:00+09:00", end: "2026-06-21T14:00:00+09:00" } });

    const res = await app.inject({ method: "GET", url: `/api/threads/${parent}` });
    const rollup = res.json().data.rollup;
    expect(rollup.direct.progress.total).toBe(1);
    expect(rollup.contains.descendantCount).toBe(2);
    expect(rollup.contains.progress).toEqual({ done: 1, total: 1 }); // grandchild's done event
    expect(rollup.total.progress).toEqual({ done: 1, total: 2 }); // parent planned + grandchild done
  });

  it("grandchild progress counted exactly once (not double-counted)", async () => {
    const parent = await createThread("Parent2");
    const child = await createThread("Child2");
    const grand = await createThread("Grand2");
    await linkThreads(parent, child);
    await linkThreads(child, grand);

    await app.inject({ method: "POST", url: "/api/events", payload: { title: "G", threadId: grand, start: "2026-06-21T10:00:00+09:00", end: "2026-06-21T11:00:00+09:00" } });

    const res = await app.inject({ method: "GET", url: `/api/threads/${parent}` });
    const rollup = res.json().data.rollup;
    expect(rollup.contains.progress.total).toBe(1);
    expect(rollup.total.progress.total).toBe(1);
  });

  it("soft contains links do not affect rollup", async () => {
    const parent = await createThread("SoftParent");
    const child = await createThread("SoftChild");
    await linkThreads(parent, child, "contains", "soft");

    const res = await app.inject({ method: "GET", url: `/api/threads/${parent}` });
    const rollup = res.json().data.rollup;
    expect(rollup.contains.descendantCount).toBe(0);
    expect(rollup.children).toHaveLength(0);
  });

  it("feeds links do not affect rollup", async () => {
    const a = await createThread("FeedA");
    const b = await createThread("FeedB");
    await linkThreads(a, b, "feeds", "hard");

    const res = await app.inject({ method: "GET", url: `/api/threads/${a}` });
    const rollup = res.json().data.rollup;
    expect(rollup.contains.descendantCount).toBe(0);
  });

  it("scheduled event durations sum to energyHours", async () => {
    const tid = await createThread("EnergyThread");
    // 2-hour event
    await app.inject({ method: "POST", url: "/api/events", payload: { title: "E1", threadId: tid, start: "2026-06-21T09:00:00+00:00", end: "2026-06-21T11:00:00+00:00" } });
    // 1.5-hour event
    await app.inject({ method: "POST", url: "/api/events", payload: { title: "E2", threadId: tid, start: "2026-06-21T13:00:00+00:00", end: "2026-06-21T14:30:00+00:00" } });

    const res = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    const rollup = res.json().data.rollup;
    expect(rollup.direct.energyHours).toBeCloseTo(3.5, 5);
  });

  it("thread with no events has zero direct energyHours", async () => {
    const tid = await createThread("NoEvents");
    const res = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    expect(res.json().data.rollup.direct.energyHours).toBe(0);
  });

  it("missingCost fields are null/unavailable", async () => {
    const tid = await createThread("MissingCost");
    const res = await app.inject({ method: "GET", url: `/api/threads/${tid}` });
    const { contains, total } = res.json().data.rollup;
    expect(contains.missingCost).toBeNull();
    expect(contains.missingCostStatus).toBe("unavailable");
    expect(total.missingCost).toBeNull();
    expect(total.missingCostStatus).toBe("unavailable");
  });

  it("children sorted by depth then name", async () => {
    const root = await createThread("Root");
    const b = await createThread("Zebra");   // depth 1
    const a = await createThread("Alpha");   // depth 1
    const c = await createThread("Deep");    // depth 2
    await linkThreads(root, b);
    await linkThreads(root, a);
    await linkThreads(a, c);

    const res = await app.inject({ method: "GET", url: `/api/threads/${root}` });
    const children = res.json().data.rollup.children as Array<{ thread: { name: string }; depth: number }>;
    expect(children[0]!.thread.name).toBe("Alpha");
    expect(children[1]!.thread.name).toBe("Zebra");
    expect(children[2]!.depth).toBe(2);
    expect(children[2]!.thread.name).toBe("Deep");
  });
});

describe("GET /api/threads/:id — paid-cost rollup (FR-THR-10 cycle-60)", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;
  beforeEach(() => {
    conn = makeTestDb();
    app = buildServer(conn.db);
  });
  afterEach(() => conn.sqlite.close());

  async function createThread(name: string) {
    const res = await app.inject({ method: "POST", url: "/api/threads", payload: { name } });
    return res.json().data.id as number;
  }
  async function linkThreads(fromId: number, toId: number, kind = "contains", firmness = "hard") {
    return app.inject({ method: "POST", url: `/api/threads/${fromId}/links`, payload: { toThreadId: toId, kind, firmness } });
  }
  // Cancel cost columns are not settable via the API; insert directly. status
  // must be a real EVENT_STATUS; only moved/cancelled count as paid cost.
  function insertCostEvent(
    threadId: number,
    status: string,
    opts: { money?: number; social?: number; effort?: string | null; window?: string | null } = {}
  ) {
    const { money = 0, social = 0, effort = null, window = null } = opts;
    conn.sqlite
      .prepare(
        "INSERT INTO events (title, source, self_imposed, status, thread_id, cancel_money, cancel_social, cancel_effort, cancel_window) VALUES (?, 'cairn', 1, ?, ?, ?, ?, ?, ?)"
      )
      .run(`evt-${status}`, status, threadId, money, social, effort, window);
  }

  it("aggregates direct/contains/total paid cost for a hard parent→child→grandchild chain", async () => {
    const parent = await createThread("PCParent");
    const child = await createThread("PCChild");
    const grand = await createThread("PCGrand");
    await linkThreads(parent, child);
    await linkThreads(child, grand);

    insertCostEvent(parent, "cancelled", { money: 1000, effort: "high", window: "tight" });
    insertCostEvent(parent, "planned", { money: 9999, window: "ignored" }); // not paid cost
    insertCostEvent(child, "moved", { money: 2000, social: 1 });
    insertCostEvent(grand, "cancelled", { money: 4000, effort: "bogus" });

    const res = await app.inject({ method: "GET", url: `/api/threads/${parent}` });
    const rollup = res.json().data.rollup;

    expect(rollup.direct.paidCost.eventCount).toBe(1);
    expect(rollup.direct.paidCost.money).toBe(1000);
    expect(rollup.direct.paidCost.effort.high).toBe(1);
    expect(rollup.direct.paidCost.windowCount).toBe(1);

    expect(rollup.contains.paidCost.eventCount).toBe(2);
    expect(rollup.contains.paidCost.money).toBe(6000);
    // child 'moved' has null effort, grand 'cancelled' has 'bogus' effort → both unknown
    expect(rollup.contains.paidCost.effort.unknown).toBe(2);

    expect(rollup.total.paidCost.eventCount).toBe(3);
    expect(rollup.total.paidCost.money).toBe(7000);
    // total == direct + contains bucket by bucket
    expect(rollup.total.paidCost.social).toBe(rollup.direct.paidCost.social + rollup.contains.paidCost.social);
  });

  it("child row exposes only its own direct paid cost; parent contains includes all descendants", async () => {
    const parent = await createThread("PC2Parent");
    const child = await createThread("PC2Child");
    const grand = await createThread("PC2Grand");
    await linkThreads(parent, child);
    await linkThreads(child, grand);
    insertCostEvent(child, "moved", { money: 2000 });
    insertCostEvent(grand, "cancelled", { money: 4000 });

    const res = await app.inject({ method: "GET", url: `/api/threads/${parent}` });
    const children = res.json().data.rollup.children as Array<{ thread: { id: number }; paidCost: { money: number } }>;
    const childRow = children.find((c) => c.thread.id === child)!;
    const grandRow = children.find((c) => c.thread.id === grand)!;
    expect(childRow.paidCost.money).toBe(2000); // child's own event only
    expect(grandRow.paidCost.money).toBe(4000);
    expect(res.json().data.rollup.contains.paidCost.money).toBe(6000); // all descendants
  });

  it("direct settlement stays direct-thread only and is unaffected by descendant paid cost", async () => {
    const parent = await createThread("PC3Parent");
    const child = await createThread("PC3Child");
    await linkThreads(parent, child);
    insertCostEvent(parent, "cancelled", { money: 1000 });
    insertCostEvent(child, "cancelled", { money: 5000 });

    const data = (await app.inject({ method: "GET", url: `/api/threads/${parent}` })).json().data;
    // settlement reflects only the parent's direct events
    expect(data.settlement.paidCost.money).toBe(1000);
    // rollup total includes the descendant
    expect(data.rollup.total.paidCost.money).toBe(6000);
  });

  it("GET /api/threads/:id stays read-only (no row-count change)", async () => {
    const parent = await createThread("PC4Parent");
    const child = await createThread("PC4Child");
    await linkThreads(parent, child);
    insertCostEvent(parent, "cancelled", { money: 1000 });
    insertCostEvent(child, "moved", { money: 2000 });

    const counts = () => {
      const tables = ["threads", "events", "tasks", "thread_links", "links", "annotations", "params"];
      return Object.fromEntries(
        tables.map((t) => [t, (conn.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n])
      );
    };
    const before = counts();
    await app.inject({ method: "GET", url: `/api/threads/${parent}` });
    expect(counts()).toEqual(before);
  });
});

// ── GET /api/threads/:id — person focus (cycle-66 FR-PPL-07/FR-XREL-03) ──────

describe("GET /api/threads/:id — person focus", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;
  beforeEach(() => { conn = makeTestDb(); app = buildServer(conn.db); });

  function insertThread(name: string): number {
    return Number(conn.sqlite.prepare("INSERT INTO threads (name) VALUES (?)").run(name).lastInsertRowid);
  }
  function insertEvent(title: string, threadId: number): number {
    return Number(conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status, thread_id) VALUES (?, '2026-06-20T10:00:00+09:00', '2026-06-20T11:00:00+09:00', 'cairn', 1, 'planned', ?)")
      .run(title, threadId).lastInsertRowid);
  }
  function insertPerson(name: string, relation: string | null): number {
    return Number(conn.sqlite.prepare("INSERT INTO people (name, relation, channel) VALUES (?, ?, 'none')").run(name, relation).lastInsertRowid);
  }
  function link(eventId: number, personId: number): void {
    conn.sqlite.prepare("INSERT INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, personId);
  }
  async function personFocus(threadId: number) {
    const body = JSON.parse((await app.inject({ method: "GET", url: `/api/threads/${threadId}` })).body);
    return body.data.personFocus.people as Array<{ person: { id: number; name: string; relation: string | null }; eventIds: number[] }>;
  }

  it("returns each person once with all matching in-thread event ids (deduped, sorted asc)", async () => {
    const t = insertThread("프로젝트");
    const e1 = insertEvent("회의1", t);
    const e2 = insertEvent("회의2", t);
    const alice = insertPerson("Alice", "동료");
    const bob = insertPerson("Bob", null);
    link(e1, alice); link(e2, alice); // Alice on both events
    link(e1, bob);                    // Bob on one
    const people = await personFocus(t);
    expect(people).toEqual([
      { person: { id: alice, name: "Alice", relation: "동료" }, eventIds: [e1, e2].sort((a, b) => a - b) },
      { person: { id: bob, name: "Bob", relation: null }, eventIds: [e1] }
    ]);
  });

  it("sorts people by name asc then id asc", async () => {
    const t = insertThread("정렬");
    const e = insertEvent("이벤트", t);
    const z = insertPerson("박", null);   // inserted first, name 박
    const a = insertPerson("김", null);   // name 김 sorts before 박
    link(e, z); link(e, a);
    const people = await personFocus(t);
    expect(people.map((p) => p.person.name)).toEqual(["김", "박"]);
  });

  it("excludes event_people rows that belong to another thread's events", async () => {
    const t1 = insertThread("스레드1");
    const t2 = insertThread("스레드2");
    const e1 = insertEvent("t1 이벤트", t1);
    const e2 = insertEvent("t2 이벤트", t2);
    const p = insertPerson("Carol", null);
    link(e2, p); // Carol only on the OTHER thread's event
    expect(await personFocus(t1)).toEqual([]);
    expect((await personFocus(t2)).map((x) => x.person.name)).toEqual(["Carol"]);
    // e1 silences an unused-var lint while documenting t1 has its own (person-less) event
    expect(e1).toBeGreaterThan(0);
  });

  it("returns an empty array for a thread with no attached people", async () => {
    const t = insertThread("사람없음");
    insertEvent("이벤트", t);
    expect(await personFocus(t)).toEqual([]);
  });

  it("GET detail is read-only: preserves all table row counts", async () => {
    const t = insertThread("카운트");
    const e = insertEvent("이벤트", t);
    const p = insertPerson("Dave", null);
    link(e, p);
    const tables = ["people", "event_people", "events", "tasks", "threads", "links", "thread_links", "resources", "resource_links", "annotations"];
    const counts = () => Object.fromEntries(tables.map((tbl) => [tbl, (conn.sqlite.prepare(`SELECT count(*) AS n FROM ${tbl}`).get() as { n: number }).n]));
    const before = counts();
    await app.inject({ method: "GET", url: `/api/threads/${t}` });
    expect(counts()).toEqual(before);
  });
});

// ── thread domain (cycle-67 FR-DOM-01) ───────────────────────────────────────

describe("thread domain — create / list / detail / db", () => {
  let app: FastifyInstance;
  let conn: ReturnType<typeof makeTestDb>;
  beforeEach(() => { conn = makeTestDb(); app = buildServer(conn.db); });

  const create = (payload: object) => app.inject({ method: "POST", url: "/api/threads", payload });

  it("POST with omitted domain stores/returns personal", async () => {
    const res = await create({ name: "기본" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.domain).toBe("personal");
    const id = res.json().data.id;
    expect((conn.sqlite.prepare("SELECT domain FROM threads WHERE id = ?").get(id) as { domain: string }).domain).toBe("personal");
  });

  it("POST with domain=work stores/returns work", async () => {
    const res = await create({ name: "업무", domain: "work" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.domain).toBe("work");
  });

  it("POST with invalid domain returns 400 and inserts no thread", async () => {
    const before = (conn.sqlite.prepare("SELECT count(*) AS n FROM threads").get() as { n: number }).n;
    const res = await create({ name: "나쁨", domain: "office" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect((conn.sqlite.prepare("SELECT count(*) AS n FROM threads").get() as { n: number }).n).toBe(before);
  });

  it("GET /api/threads filters by domain and preserves all-order otherwise", async () => {
    await create({ name: "P1" });
    await create({ name: "W1", domain: "work" });
    await create({ name: "P2" });
    const names = async (q: string) => (await app.inject({ method: "GET", url: `/api/threads${q}` })).json().data.map((s: { thread: { name: string } }) => s.thread.name);
    expect(await names("")).toEqual(["P2", "W1", "P1"]); // all, createdAt/id desc
    expect(await names("?domain=all")).toEqual(["P2", "W1", "P1"]);
    expect(await names("?domain=personal")).toEqual(["P2", "P1"]);
    expect(await names("?domain=work")).toEqual(["W1"]);
  });

  it("GET /api/threads rejects an invalid domain query with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/threads?domain=office" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/threads/:id includes the domain on the thread object", async () => {
    const id = (await create({ name: "상세", domain: "work" })).json().data.id;
    const res = await app.inject({ method: "GET", url: `/api/threads/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.thread.domain).toBe("work");
    // existing detail fields still present
    expect(res.json().data.personFocus).toBeDefined();
    expect(res.json().data.resume).toBeDefined();
  });

  it("DB column defaults to personal and CHECK rejects an invalid domain", () => {
    const id = Number(conn.sqlite.prepare("INSERT INTO threads (name) VALUES ('레거시')").run().lastInsertRowid);
    expect((conn.sqlite.prepare("SELECT domain FROM threads WHERE id = ?").get(id) as { domain: string }).domain).toBe("personal");
    expect(() => conn.sqlite.prepare("INSERT INTO threads (name, domain) VALUES ('나쁨', 'school')").run()).toThrow();
  });
});
