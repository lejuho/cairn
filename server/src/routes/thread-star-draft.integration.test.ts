import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadStarDraftResponseDataSchema, type ChatCompletionRequest } from "@cairn/shared";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import type { LlmGateway, LlmGatewayResult } from "../llm/gateway.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-star-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}
afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function gateway(handler: (req: ChatCompletionRequest) => LlmGatewayResult): LlmGateway {
  return { chatCompletionsUrl: new URL("http://localhost:8000/v1/chat/completions"), async completeChat(req) { return handler(req); } };
}
function narrativeGateway(narrative: object): LlmGateway {
  return gateway(() => ({ ok: true, data: { id: "t", object: "chat.completion" as const, created: 0, model: "grok-3-mini", choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify(narrative) }, finish_reason: "stop" }] } }));
}
const NARRATIVE = { situation: "파리 여행을 준비했다.", task: "예약을 마쳐야 했다.", action: "비교 후 예약했다.", result: "일정대로 끝냈다.", skills: ["계획", "조율"] };

function insertThread(conn: SqliteConnection, name: string, status: string): number {
  return Number(conn.sqlite.prepare("INSERT INTO threads (name, kind, goal, status) VALUES (?, 'trip', '6월 파리', ?)").run(name, status).lastInsertRowid);
}
function insertEvent(conn: SqliteConnection, threadId: number, title: string): number {
  return Number(conn.sqlite.prepare("INSERT INTO events (title, thread_id, source, self_imposed, status) VALUES (?,?, 'cairn',1,'done')").run(title, threadId).lastInsertRowid);
}
function insertAnnotation(conn: SqliteConnection, eventId: number, text: string): void {
  conn.sqlite.prepare("INSERT INTO annotations (event_id, outcome, reason_text) VALUES (?, 'done', ?)").run(eventId, text);
}
const counts = (conn: SqliteConnection) => ({
  threads: (conn.sqlite.prepare("SELECT count(*) c FROM threads").get() as { c: number }).c,
  events: (conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number }).c,
  tasks: (conn.sqlite.prepare("SELECT count(*) c FROM tasks").get() as { c: number }).c,
  annotations: (conn.sqlite.prepare("SELECT count(*) c FROM annotations").get() as { c: number }).c
});

describe("POST /api/threads/:id/star-draft (cycle-55)", () => {
  it("returns a STAR draft for a completed thread with nodes/annotations/settlement", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리 여행", "done");
    const e = insertEvent(conn, t, "항공권 예약");
    insertAnnotation(conn, e, "예약 완료");
    const before = counts(conn);
    const app = buildServer(conn.db, narrativeGateway(NARRATIVE));
    const res = await app.inject({ method: "POST", url: `/api/threads/${t}/star-draft` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(ThreadStarDraftResponseDataSchema.safeParse(data).success).toBe(true);
    expect(data.draft.confidence).toBe("draft");
    expect(data.draft.reasonCodes).toContain("star_user_must_edit");
    expect(data.evidence.thread).toMatchObject({ id: t, name: "파리 여행", kind: "trip", goal: "6월 파리" });
    expect(data.evidence.nodeTitles).toContain("항공권 예약");
    expect(data.evidence.annotationCount).toBe(1);
    expect(data.evidence.settlement.status).toBe("ready");
    expect(counts(conn)).toEqual(before); // no DB writes
  });

  it("includes warnings when goal/annotations are missing but still drafts", async () => {
    const conn = makeTestDb();
    const t = Number(conn.sqlite.prepare("INSERT INTO threads (name, kind, status) VALUES ('빈 스레드','trip','done')").run().lastInsertRowid);
    insertEvent(conn, t, "노드");
    const app = buildServer(conn.db, narrativeGateway(NARRATIVE));
    const data = (await app.inject({ method: "POST", url: `/api/threads/${t}/star-draft` })).json().data;
    expect(data.evidence.warnings.length).toBeGreaterThan(0);
  });

  it("returns 409 THREAD_NOT_DONE for active/paused/dropped threads with no writes", async () => {
    const conn = makeTestDb();
    const before0 = counts(conn);
    for (const st of ["active", "paused", "dropped"]) {
      const t = insertThread(conn, `s-${st}`, st);
      const app = buildServer(conn.db, narrativeGateway(NARRATIVE));
      const res = await app.inject({ method: "POST", url: `/api/threads/${t}/star-draft` });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("THREAD_NOT_DONE");
    }
    void before0;
  });

  it("returns 404 for unknown thread and 400 for bad id", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, narrativeGateway(NARRATIVE));
    expect((await app.inject({ method: "POST", url: "/api/threads/9999/star-draft" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/threads/0/star-draft" })).statusCode).toBe(400);
  });

  it("returns 503 LLM_UNAVAILABLE on gateway failure with no writes", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리", "done");
    insertEvent(conn, t, "노드");
    const before = counts(conn);
    const app = buildServer(conn.db, gateway(() => ({ ok: false, error: { code: "unavailable", message: "down" } })));
    const res = await app.inject({ method: "POST", url: `/api/threads/${t}/star-draft` });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("LLM_UNAVAILABLE");
    expect(counts(conn)).toEqual(before);
  });

  it("returns 502 LLM_INVALID_DRAFT on schema-invalid model output with no writes", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리", "done");
    insertEvent(conn, t, "노드");
    const before = counts(conn);
    const app = buildServer(conn.db, narrativeGateway({ situation: "", task: "t", action: "a", result: "r", skills: [] }));
    const res = await app.inject({ method: "POST", url: `/api/threads/${t}/star-draft` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("LLM_INVALID_DRAFT");
    expect(counts(conn)).toEqual(before);
  });

  it("is not registered without a gateway; deterministic GET /api/threads/:id still works", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "파리", "done");
    const app = buildServer(conn.db); // no gateway
    expect((await app.inject({ method: "POST", url: `/api/threads/${t}/star-draft` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/threads/${t}` })).statusCode).toBe(200);
  });
});
