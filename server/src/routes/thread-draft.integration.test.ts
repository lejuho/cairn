import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatCompletionRequest } from "@cairn/shared";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import type { LlmGateway, LlmGatewayResult } from "../llm/gateway.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-draft-"));
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
  return {
    chatCompletionsUrl: new URL("http://localhost:8000/v1/chat/completions"),
    async completeChat(req) { return handler(req); }
  };
}
function draftGateway(draft: object): LlmGateway {
  return gateway(() => ({
    ok: true,
    data: { id: "t", object: "chat.completion" as const, created: 0, model: "grok-3-mini",
      choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify(draft) }, finish_reason: "stop" }] }
  }));
}
const count = (conn: SqliteConnection, t: string) => (conn.sqlite.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
const counts = (conn: SqliteConnection) => ({ threads: count(conn, "threads"), events: count(conn, "events"), tasks: count(conn, "tasks"), links: count(conn, "links") });

const VALID_DRAFT = {
  thread: { name: "파리 여행", kind: "travel", goal: "6월 초 파리", deadline: "2026-06-01" },
  events: [{ tempId: "e1", title: "항공권 예약", type: "travel", start: null, end: null, location: null, mode: null }],
  tasks: [{ tempId: "t1", title: "여권 확인", estMinutes: null, due: null, context: null, optional: false }],
  links: [{ from: { kind: "task", tempId: "t1" }, to: { kind: "event", tempId: "e1" }, kind: "requires" }],
  warnings: [{ code: "unknown_date", message: "날짜가 필요해" }]
};

describe("POST /api/threads/draft", () => {
  it("inserts one thread, nodes, and soft/inferred links", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, draftGateway(VALID_DRAFT));
    const res = await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "파리 여행 계획 짜줘" } });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.thread.name).toBe("파리 여행");
    expect(data.events).toHaveLength(1);
    expect(data.tasks).toHaveLength(1);
    expect(data.nodeLinks).toHaveLength(1);
    expect(data.warnings).toHaveLength(1);
    // event/task defaults + link firmness/source
    expect(data.events[0]).toMatchObject({ source: "cairn", selfImposed: 1, status: "planned", threadId: data.thread.id });
    expect(data.tasks[0]).toMatchObject({ status: "todo", threadId: data.thread.id });
    const linkRow = conn.sqlite.prepare("SELECT firmness, source FROM links").get() as { firmness: string; source: string };
    expect(linkRow).toEqual({ firmness: "soft", source: "inferred" });
    expect(counts(conn)).toEqual({ threads: 1, events: 1, tasks: 1, links: 1 });
  });

  it("creates a thread with warnings and no fabricated nodes for a broad description", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, draftGateway({ thread: { name: "막연한 계획" }, events: [], tasks: [], links: [], warnings: [{ code: "needs_detail", message: "구체적 항목이 필요해" }] }));
    const res = await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "뭔가 해야 해" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.events).toHaveLength(0);
    expect(res.json().data.tasks).toHaveLength(0);
    expect(counts(conn)).toMatchObject({ threads: 1, events: 0, tasks: 0, links: 0 });
  });

  it("persists placeholder unknown text fields as NULL, not as fact", async () => {
    const conn = makeTestDb();
    const draft = {
      thread: { name: "파리 여행", kind: "TBD", goal: "?", deadline: null },
      events: [{ tempId: "e1", title: "항공권 예약", type: "unknown", start: null, end: null, location: "미정", mode: null }],
      tasks: [{ tempId: "t1", title: "여권 확인", estMinutes: null, due: null, context: "  ", optional: false }],
      links: [], warnings: []
    };
    const app = buildServer(conn.db, draftGateway(draft));
    const res = await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "x" } });
    expect(res.statusCode).toBe(201);
    const t = conn.sqlite.prepare("SELECT kind, goal FROM threads").get() as { kind: string | null; goal: string | null };
    expect(t).toEqual({ kind: null, goal: null });
    const ev = conn.sqlite.prepare("SELECT type, location FROM events").get() as { type: string | null; location: string | null };
    expect(ev).toEqual({ type: null, location: null });
    const tk = conn.sqlite.prepare("SELECT context FROM tasks").get() as { context: string | null };
    expect(tk.context).toBeNull();
    // response reflects the normalized nulls
    expect(res.json().data.thread.kind).toBeNull();
    expect(res.json().data.events[0].location).toBeNull();
  });

  it("rejects a dangling link temp id with 502 and writes nothing", async () => {
    const conn = makeTestDb();
    const bad = { ...VALID_DRAFT, links: [{ from: { kind: "task", tempId: "ghost" }, to: { kind: "event", tempId: "e1" }, kind: "requires" }] };
    const app = buildServer(conn.db, draftGateway(bad));
    const res = await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "x" } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("LLM_INVALID_DRAFT");
    expect(counts(conn)).toEqual({ threads: 0, events: 0, tasks: 0, links: 0 });
  });

  it("rejects an invalid enum/mode draft with 502 and writes nothing", async () => {
    const conn = makeTestDb();
    const bad = { ...VALID_DRAFT, events: [{ ...VALID_DRAFT.events[0], mode: "hybrid" }] };
    const app = buildServer(conn.db, draftGateway(bad));
    const res = await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "x" } });
    expect(res.statusCode).toBe(502);
    expect(counts(conn)).toEqual({ threads: 0, events: 0, tasks: 0, links: 0 });
  });

  it("rejects an offsetless date draft with 502 and writes nothing", async () => {
    const conn = makeTestDb();
    const bad = { ...VALID_DRAFT, events: [{ ...VALID_DRAFT.events[0], start: "2026-06-20T09:00:00" }] };
    const app = buildServer(conn.db, draftGateway(bad));
    const res = await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "x" } });
    expect(res.statusCode).toBe(502);
    expect(counts(conn)).toEqual({ threads: 0, events: 0, tasks: 0, links: 0 });
  });

  it("returns 503 LLM_UNAVAILABLE on gateway failure and writes nothing", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, gateway(() => ({ ok: false, error: { code: "unavailable", message: "down" } })));
    const res = await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "x" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("LLM_UNAVAILABLE");
    expect(counts(conn)).toEqual({ threads: 0, events: 0, tasks: 0, links: 0 });
  });

  it("rejects an invalid body with 400", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, draftGateway(VALID_DRAFT));
    expect((await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "  " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/threads/draft", payload: { autoApply: true } })).statusCode).toBe(400);
  });

  it("GET /api/threads/:id after draft returns nodes and nodeLinks", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, draftGateway(VALID_DRAFT));
    const created = (await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "파리" } })).json().data;
    const detail = (await app.inject({ method: "GET", url: `/api/threads/${created.thread.id}` })).json().data;
    expect(detail.events).toHaveLength(1);
    expect(detail.tasks).toHaveLength(1);
    expect(detail.nodeLinks).toHaveLength(1);
    expect(detail.nodeLinks[0]).toMatchObject({ firmness: "soft", source: "inferred" });
  });

  it("is not registered without a gateway (manual POST /api/threads still works)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db); // no gateway
    expect((await app.inject({ method: "POST", url: "/api/threads/draft", payload: { text: "x" } })).statusCode).toBe(404);
    const manual = await app.inject({ method: "POST", url: "/api/threads", payload: { name: "수동 스레드" } });
    expect(manual.statusCode).toBe(201);
  });
});
