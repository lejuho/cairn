import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";
import type { LlmGateway, LlmGatewayResult } from "../llm/gateway.js";
import type { ChatCompletionRequest } from "@cairn/shared";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-cap-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function makeGateway(
  handler: (req: ChatCompletionRequest) => LlmGatewayResult | Promise<LlmGatewayResult>
): LlmGateway {
  return {
    chatCompletionsUrl: new URL("http://localhost:8000/v1/chat/completions"),
    completeChat: async (req) => handler(req)
  };
}

function okGateway(content: string): LlmGateway {
  return makeGateway(() => ({
    ok: true,
    data: {
      id: "test",
      object: "chat.completion",
      created: 0,
      model: "grok-3-mini",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
    }
  }));
}

function failGateway(code: "unavailable" | "rate_limited" | "invalid_response" | "queue_full"): LlmGateway {
  return makeGateway(() => ({ ok: false, error: { code, message: code } }));
}

describe("POST /api/capture/flat-event", () => {
  let conn: ReturnType<typeof makeTestDb>;

  beforeEach(() => { conn = makeTestDb(); });
  afterEach(() => conn.sqlite.close());

  it("returns 400 for empty text", async () => {
    const app = buildServer(conn.db, okGateway("{}"));
    const res = await app.inject({ method: "POST", url: "/api/capture/flat-event", payload: { text: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for whitespace-only text", async () => {
    const app = buildServer(conn.db, okGateway("{}"));
    const res = await app.inject({ method: "POST", url: "/api/capture/flat-event", payload: { text: "   " } });
    expect(res.statusCode).toBe(400);
  });

  it("scheduled parse inserts one event with correct fields", async () => {
    const gw = okGateway(JSON.stringify({ title: "치과", start: "2026-06-20T14:00:00+09:00" }));
    const app = buildServer(conn.db, gw);
    const res = await app.inject({
      method: "POST", url: "/api/capture/flat-event",
      payload: { text: "내일 오후 2시 치과", now: "2026-06-19T10:00:00+09:00", timeZone: "Asia/Seoul" }
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.captureStatus).toBe("scheduled");
    expect(data.event.title).toBe("치과");
    expect(data.event.start).toBe("2026-06-20T14:00:00+09:00");
    expect(data.event.source).toBe("cairn");
    expect(data.event.selfImposed).toBe(1);
    expect(data.event.status).toBe("planned");
    expect(data.event.threadId).toBeNull();
  });

  it("missing parsed end defaults to start + 60 minutes, preserving offset", async () => {
    const gw = okGateway(JSON.stringify({ title: "회의", start: "2026-06-20T10:00:00+09:00" }));
    const app = buildServer(conn.db, gw);
    const res = await app.inject({
      method: "POST", url: "/api/capture/flat-event",
      payload: { text: "내일 오전 10시 회의" }
    });
    const { data } = res.json();
    expect(data.captureStatus).toBe("scheduled");
    expect(data.event.end).toBe("2026-06-20T11:00:00+09:00");
  });

  it("parse with no start inserts unscheduled event", async () => {
    const gw = okGateway(JSON.stringify({ title: "독서" }));
    const app = buildServer(conn.db, gw);
    const res = await app.inject({
      method: "POST", url: "/api/capture/flat-event", payload: { text: "독서 해야함" }
    });
    const { data } = res.json();
    expect(data.captureStatus).toBe("unscheduled");
    expect(data.event.start).toBeNull();
    expect(data.event.end).toBeNull();
    expect(data.event.title).toBe("독서");
  });

  it("LLM unavailable raw-stores trimmed input text with llmError", async () => {
    const app = buildServer(conn.db, failGateway("unavailable"));
    const res = await app.inject({
      method: "POST", url: "/api/capture/flat-event", payload: { text: "  주간 회의  " }
    });
    const { data } = res.json();
    expect(data.captureStatus).toBe("raw_stored");
    expect(data.event.title).toBe("주간 회의");
    expect(data.event.start).toBeNull();
    expect(data.llmError).toBe("unavailable");
  });

  it("LLM rate_limited raw-stores with llmError", async () => {
    const app = buildServer(conn.db, failGateway("rate_limited"));
    const res = await app.inject({
      method: "POST", url: "/api/capture/flat-event", payload: { text: "미팅" }
    });
    const { data } = res.json();
    expect(data.captureStatus).toBe("raw_stored");
    expect(data.llmError).toBe("rate_limited");
  });

  it("invalid LLM JSON raw-stores with llmError", async () => {
    const app = buildServer(conn.db, okGateway("not json at all"));
    const res = await app.inject({
      method: "POST", url: "/api/capture/flat-event", payload: { text: "운동" }
    });
    const { data } = res.json();
    expect(data.captureStatus).toBe("raw_stored");
    expect(data.llmError).toBe("invalid_json");
  });

  it("invalid LLM schema (missing title) raw-stores with llmError", async () => {
    const app = buildServer(conn.db, okGateway(JSON.stringify({ start: "2026-06-20T10:00:00+09:00" })));
    const res = await app.inject({
      method: "POST", url: "/api/capture/flat-event", payload: { text: "무언가" }
    });
    const { data } = res.json();
    expect(data.captureStatus).toBe("raw_stored");
    expect(data.llmError).toBe("invalid_schema");
  });

  it("scheduled capture appears in GET /api/today dayEvents", async () => {
    const date = "2026-06-20";
    const gw = okGateway(JSON.stringify({ title: "점심", start: `${date}T12:00:00+00:00` }));
    const app = buildServer(conn.db, gw);
    await app.inject({
      method: "POST", url: "/api/capture/flat-event", payload: { text: "점심 약속" }
    });
    const today = await app.inject({ method: "GET", url: `/api/today?date=${date}&now=${date}T00:00:00%2B00:00` });
    const { data } = today.json();
    const found = data.dayEvents.some((e: { title: string }) => e.title === "점심");
    expect(found).toBe(true);
  });

  it("unscheduled capture is persisted but not in dayEvents", async () => {
    const date = "2026-06-20";
    const gw = okGateway(JSON.stringify({ title: "독서" }));
    const app = buildServer(conn.db, gw);
    await app.inject({
      method: "POST", url: "/api/capture/flat-event", payload: { text: "독서" }
    });
    const today = await app.inject({ method: "GET", url: `/api/today?date=${date}&now=${date}T00:00:00%2B00:00` });
    const { data } = today.json();
    const inDay = data.dayEvents.some((e: { title: string }) => e.title === "독서");
    expect(inDay).toBe(false);
  });

  it("no thread, task, or link row created", async () => {
    const gw = okGateway(JSON.stringify({ title: "조깅", start: "2026-06-20T07:00:00+09:00" }));
    const app = buildServer(conn.db, gw);
    await app.inject({ method: "POST", url: "/api/capture/flat-event", payload: { text: "조깅" } });
    const threads = await app.inject({ method: "GET", url: "/api/threads" });
    expect(threads.json().data).toHaveLength(0);
  });

  it("deterministic Today boundary: no LLM import in today route/service", async () => {
    const todaySrc = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("../routes/today.ts", import.meta.url).pathname, "utf-8") +
      readFileSync(new URL("../services/today.ts", import.meta.url).pathname, "utf-8")
    );
    expect(todaySrc).not.toContain("completeChat");
    expect(todaySrc).not.toContain("llm/gateway");
    expect(todaySrc).not.toContain("flatCapture");
  });
});
