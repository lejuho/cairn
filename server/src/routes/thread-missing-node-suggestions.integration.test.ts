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
  const dir = mkdtempSync(join(tmpdir(), "cairn-mns-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertThread(conn: SqliteConnection, name: string, kind: string | null, status = "active"): number {
  return Number(conn.sqlite.prepare("INSERT INTO threads (name, kind, status) VALUES (?,?,?)").run(name, kind, status).lastInsertRowid);
}
function insertEvent(conn: SqliteConnection, threadId: number, title: string, status = "done"): void {
  conn.sqlite.prepare("INSERT INTO events (title, thread_id, source, self_imposed, status) VALUES (?,?, 'cairn',1,?)").run(title, threadId, status);
}
function insertTask(conn: SqliteConnection, threadId: number, title: string, status = "done"): void {
  conn.sqlite.prepare("INSERT INTO tasks (title, thread_id, status, optional) VALUES (?,?,?,0)").run(title, threadId, status);
}
function insertContains(conn: SqliteConnection, parent: number, child: number): void {
  conn.sqlite.prepare("INSERT INTO thread_links (from_thread, to_thread, kind, firmness) VALUES (?,?, 'contains','hard')").run(parent, child);
}

describe("GET /api/threads/:id missingNodeSuggestions (cycle-54)", () => {
  it("returns soft/inferred suggestions for an active same-kind thread", async () => {
    const conn = makeTestDb();
    const current = insertThread(conn, "이번 여행", "trip", "active");
    const past = insertThread(conn, "지난 여행", "trip", "done");
    insertEvent(conn, past, "비자 신청", "done");
    insertTask(conn, past, "짐 싸기", "done");
    insertEvent(conn, current, "항공권 예약", "planned"); // current has its own, unrelated
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/threads/${current}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json().data;
    expect(ThreadDetailSchema.safeParse(detail).success).toBe(true);
    const titles = detail.missingNodeSuggestions.map((s: { title: string }) => s.title).sort();
    expect(titles).toEqual(["비자 신청", "짐 싸기"]);
    expect(detail.missingNodeSuggestions.every((s: { firmness: string; source: string }) => s.firmness === "soft" && s.source === "inferred")).toBe(true);
  });

  it("returns [] when no eligible same-kind completed evidence exists", async () => {
    const conn = makeTestDb();
    const current = insertThread(conn, "이번 여행", "trip", "active");
    insertThread(conn, "다른 종류 완료", "project", "done"); // different kind
    const activeSame = insertThread(conn, "진행 중 여행", "trip", "active"); // same kind but not done
    insertEvent(conn, activeSame, "비자", "done");
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${current}` })).json().data;
    expect(detail.missingNodeSuggestions).toEqual([]);
  });

  it("excludes contains-child thread nodes from direct suggestions", async () => {
    const conn = makeTestDb();
    const current = insertThread(conn, "이번", "trip", "active");
    const pastParent = insertThread(conn, "지난 상위", "trip", "done");
    const pastChild = insertThread(conn, "지난 하위", "trip", "done");
    insertContains(conn, pastParent, pastChild);
    insertEvent(conn, pastParent, "부모 노드", "done");
    insertEvent(conn, pastChild, "자식 노드", "done"); // child's own node — also same kind 'trip' done, so it IS a direct node of pastChild (a completed same-kind thread) → eligible on its own
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${current}` })).json().data;
    // Both pastParent and pastChild are completed same-kind threads; their OWN
    // direct nodes contribute, but neither pulls the other's nodes as descendants.
    const titles = detail.missingNodeSuggestions.map((s: { title: string }) => s.title).sort();
    expect(titles).toEqual(["부모 노드", "자식 노드"]);
    // each is direct-only evidence from exactly one thread
    expect(detail.missingNodeSuggestions.every((s: { evidenceThreadCount: number }) => s.evidenceThreadCount === 1)).toBe(true);
  });

  it("matches evidence on the EXACT persisted kind, not a trimmed kind (ISSUE-1)", async () => {
    const conn = makeTestDb();
    const current = insertThread(conn, "이번 여행", " trip ", "active"); // padded kind
    const trimmedKind = insertThread(conn, "트림된 여행", "trip", "done"); // not exact → must NOT match
    const exactKind = insertThread(conn, "정확 패딩 여행", " trip ", "done"); // exact → must match
    insertEvent(conn, trimmedKind, "잘못된 후보", "done");
    insertEvent(conn, exactKind, "올바른 후보", "done");
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${current}` })).json().data;
    const titles = detail.missingNodeSuggestions.map((s: { title: string }) => s.title);
    expect(titles).toEqual(["올바른 후보"]);
    expect(titles).not.toContain("잘못된 후보");
  });

  it("existing thread detail fields still validate alongside suggestions", async () => {
    const conn = makeTestDb();
    const current = insertThread(conn, "이번", "trip", "active");
    insertThread(conn, "지난", "trip", "done");
    const app = buildServer(conn.db);
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${current}` })).json().data;
    expect(ThreadDetailSchema.safeParse(detail).success).toBe(true);
    for (const f of ["relations", "rollup", "nodeLinks", "unknownBlockers", "settlement", "missingNodeSuggestions", "progress"]) {
      expect(detail[f]).toBeDefined();
    }
  });
});
