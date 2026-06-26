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
  const dir = mkdtempSync(join(tmpdir(), "cairn-settle-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertThread(conn: SqliteConnection, name: string, status = "active"): number {
  return Number(conn.sqlite.prepare("INSERT INTO threads (name, status) VALUES (?, ?)").run(name, status).lastInsertRowid);
}
function insertEvent(conn: SqliteConnection, threadId: number | null, opts: { title?: string; status?: string; money?: number; social?: number; effort?: string; window?: string | null } = {}): number {
  return Number(
    conn.sqlite
      .prepare("INSERT INTO events (title, thread_id, source, self_imposed, status, cancel_money, cancel_social, cancel_effort, cancel_window) VALUES (?,?, 'cairn',1, ?, ?, ?, ?, ?)")
      .run(opts.title ?? "E", threadId, opts.status ?? "planned", opts.money ?? 0, opts.social ?? 0, opts.effort ?? "none", opts.window ?? null).lastInsertRowid
  );
}
function insertTask(conn: SqliteConnection, threadId: number | null, status = "todo"): number {
  return Number(conn.sqlite.prepare("INSERT INTO tasks (title, thread_id, status, optional) VALUES ('T',?,?,0)").run(threadId, status).lastInsertRowid);
}

describe("GET /api/threads/:id settlement (cycle-53)", () => {
  it("returns a ready settlement for a done thread with paid cost + avoided evidence", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "완료 스레드", "done");
    insertEvent(conn, t, { title: "본 행사", status: "done" });
    insertEvent(conn, t, { title: "취소 미팅", status: "cancelled", money: 3000, social: 1, effort: "medium", window: "내일" });
    insertEvent(conn, t, { title: "이동 미팅", status: "moved", money: 1000, social: 0, effort: "low", window: null });
    insertTask(conn, t, "done");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${t}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json().data;
    expect(ThreadDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.settlement.status).toBe("ready");
    // countable = not cancelled/dropped: done event + moved event + done task = 3;
    // done = done event + done task = 2 (moved is countable but not done).
    expect(detail.settlement.avoidedMissing).toMatchObject({ doneCount: 2, totalCount: 3, unknownCostCount: 1 });
    expect(detail.settlement.sampleStatus).toBe("partial");
    // paid cost from cancelled + moved
    expect(detail.settlement.paidCost.eventCount).toBe(2);
    expect(detail.settlement.paidCost.money).toBe(4000);
    expect(detail.settlement.paidCost.social).toBe(1);
    expect(detail.settlement.paidCost.effort).toMatchObject({ low: 1, medium: 1 });
    expect(detail.settlement.paidCost.windowCount).toBe(1);
  });

  it("returns not_ready settlement for an active thread", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "진행 스레드", "active");
    insertEvent(conn, t, { status: "planned" });
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t}` })).json().data;
    expect(detail.settlement.status).toBe("not_ready");
    expect(detail.settlement.sampleStatus).toBe("partial");
  });

  it("contains-child thread nodes do not enter direct settlement", async () => {
    const conn = makeTestDb();
    const parent = insertThread(conn, "상위", "done");
    const child = insertThread(conn, "하위", "done");
    // parent hard-contains child
    conn.sqlite.prepare("INSERT INTO thread_links (from_thread, to_thread, kind, firmness) VALUES (?,?, 'contains','hard')").run(parent, child);
    insertEvent(conn, parent, { status: "done" });
    insertEvent(conn, child, { status: "cancelled", money: 9999 }); // child cost must NOT enter parent direct settlement
    insertTask(conn, child, "done");
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${parent}` })).json().data;
    expect(detail.settlement.paidCost.money).toBe(0); // child cancelled cost excluded
    expect(detail.settlement.paidCost.eventCount).toBe(0);
    expect(detail.settlement.avoidedMissing.totalCount).toBe(1); // only parent's done event
  });

  it("existing thread detail fields still validate alongside settlement", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "스레드", "done");
    insertEvent(conn, t, { status: "done" });
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${t}` })).json().data;
    expect(ThreadDetailSchema.safeParse(detail).success).toBe(true);
    for (const f of ["relations", "rollup", "nodeLinks", "unknownBlockers", "settlement", "progress"]) {
      expect(detail[f]).toBeDefined();
    }
  });
});
