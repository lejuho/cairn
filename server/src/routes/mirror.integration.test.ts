import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MirrorLedgerDataSchema } from "@cairn/shared";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-mirror-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertEvent(
  conn: SqliteConnection,
  opts: {
    title?: string;
    threadId?: number | null;
    start?: string | null;
    cancelMoney?: number;
    cancelSocial?: number;
    cancelEffort?: string | null;
    cancelWindow?: string | null;
  } = {}
): number {
  const res = conn.sqlite
    .prepare(
      `INSERT INTO events (title, thread_id, start, source, self_imposed, status,
        cancel_money, cancel_social, cancel_effort, cancel_window)
       VALUES (?, ?, ?, 'cairn', 1, 'planned', ?, ?, ?, ?)`
    )
    .run(
      opts.title ?? "E",
      opts.threadId ?? null,
      opts.start ?? null,
      opts.cancelMoney ?? 0,
      opts.cancelSocial ?? 0,
      opts.cancelEffort ?? "none",
      opts.cancelWindow ?? null
    );
  return Number(res.lastInsertRowid);
}

function insertAnnotation(
  conn: SqliteConnection,
  eventId: number | null,
  outcome: string,
  loggedAt: string,
  opts: { reasonTags?: string | null; reasonText?: string | null } = {}
): number {
  const res = conn.sqlite
    .prepare(
      `INSERT INTO annotations (event_id, outcome, reason_tags, reason_text, logged_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(eventId, outcome, opts.reasonTags ?? null, opts.reasonText ?? null, loggedAt);
  return Number(res.lastInsertRowid);
}

function insertThread(conn: SqliteConnection, name: string): number {
  const res = conn.sqlite.prepare(`INSERT INTO threads (name) VALUES (?)`).run(name);
  return Number(res.lastInsertRowid);
}

describe("GET /api/mirror/ledger", () => {
  it("includes moved/cancelled annotations joined to events", async () => {
    const conn = makeTestDb();
    const threadId = insertThread(conn, "프로젝트");
    const ev = insertEvent(conn, { title: "팀 회의", threadId, cancelMoney: 12000, cancelSocial: 2, cancelEffort: "medium", cancelWindow: "same_day" });
    insertAnnotation(conn, ev, "moved", "2026-06-15 09:00:00", { reasonTags: '["conflict_resolution"]', reasonText: "겹쳤어" });

    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?from=2026-06-01&to=2026-06-30" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
    const data = MirrorLedgerDataSchema.parse(body.data);
    expect(data.entries).toHaveLength(1);
    const entry = data.entries[0]!;
    expect(entry.eventTitle).toBe("팀 회의");
    expect(entry.outcome).toBe("moved");
    expect(entry.thread).toEqual({ id: threadId, name: "프로젝트" });
    expect(entry.cost).toEqual({ money: 12000, social: 2, effort: "medium", window: "same_day", hasAnyCost: true });
    expect(entry.reasonTags).toEqual(["conflict_resolution"]);
    expect(data.summary.movedCount).toBe(1);
    conn.sqlite.close();
  });

  it("excludes done and late annotations", async () => {
    const conn = makeTestDb();
    const ev = insertEvent(conn, {});
    insertAnnotation(conn, ev, "done", "2026-06-15 09:00:00");
    insertAnnotation(conn, ev, "late", "2026-06-15 10:00:00");
    insertAnnotation(conn, ev, "cancelled", "2026-06-15 11:00:00");

    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?from=2026-06-01&to=2026-06-30" });
    const data = MirrorLedgerDataSchema.parse((res.json() as { data: unknown }).data);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]!.outcome).toBe("cancelled");
    conn.sqlite.close();
  });

  it("filters by logged_at literal date", async () => {
    const conn = makeTestDb();
    const ev = insertEvent(conn, {});
    insertAnnotation(conn, ev, "moved", "2026-05-31 23:00:00"); // before
    insertAnnotation(conn, ev, "moved", "2026-06-15 12:00:00"); // inside
    insertAnnotation(conn, ev, "moved", "2026-07-01 00:00:00"); // after

    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?from=2026-06-01&to=2026-06-30" });
    const data = MirrorLedgerDataSchema.parse((res.json() as { data: unknown }).data);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]!.loggedAt.slice(0, 10)).toBe("2026-06-15");
    conn.sqlite.close();
  });

  it("does not 500 on malformed reason_tags", async () => {
    const conn = makeTestDb();
    const ev = insertEvent(conn, {});
    insertAnnotation(conn, ev, "moved", "2026-06-15 09:00:00", { reasonTags: "{not valid json" });

    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?from=2026-06-01&to=2026-06-30" });
    expect(res.statusCode).toBe(200);
    const data = MirrorLedgerDataSchema.parse((res.json() as { data: unknown }).data);
    expect(data.entries[0]!.reasonTags).toEqual([]);
    conn.sqlite.close();
  });

  it("does not crash when the event join is missing", async () => {
    const conn = makeTestDb();
    insertAnnotation(conn, null, "moved", "2026-06-15 09:00:00");

    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?from=2026-06-01&to=2026-06-30" });
    expect(res.statusCode).toBe(200);
    const data = MirrorLedgerDataSchema.parse((res.json() as { data: unknown }).data);
    expect(data.entries).toHaveLength(0);
    conn.sqlite.close();
  });

  it("returns 400 on an invalid date", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?from=2026/06/01" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("returns 400 on an impossible calendar date (2026-99-99)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?from=2026-99-99" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("returns 400 on an overflow calendar date (2026-02-30)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?to=2026-02-30" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("returns 400 on a reversed range", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger?from=2026-06-30&to=2026-06-01" });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("works with no LLM gateway (deterministic route)", async () => {
    const conn = makeTestDb();
    const ev = insertEvent(conn, {});
    insertAnnotation(conn, ev, "moved", "2026-06-15 09:00:00");
    // buildServer(conn.db) builds without a gateway argument.
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/ledger" });
    expect(res.statusCode).toBe(200);
    conn.sqlite.close();
  });
});
