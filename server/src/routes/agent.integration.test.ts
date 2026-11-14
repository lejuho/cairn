import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import type { CompleteInput } from "../agent/providers.js";
import { parseTurn } from "../agent/loop.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { events, tasks, threadLinks, threads } from "../db/schema.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-agent-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

// A scripted model: returns the next canned reply and records what it was shown.
function scripted(replies: Array<object | string>) {
  const seen: CompleteInput[] = [];
  const complete = async (input: CompleteInput) => {
    seen.push(input);
    const next = replies.shift();
    if (next === undefined) throw new Error("model called more often than scripted");
    return typeof next === "string" ? next : JSON.stringify(next);
  };
  return { complete, seen };
}

describe("agent panel", () => {
  let conn: SqliteConnection;
  let a: number;
  let b: number;

  beforeEach(() => {
    conn = makeTestDb();
    [a, b] = conn.db.insert(threads).values([{ name: "졸업 프로젝트" }, { name: "실험 설계" }]).returning().all().map((t) => t.id) as [number, number];
  });

  function chat(app: ReturnType<typeof buildServer>, text: string, extra: Record<string, unknown> = {}) {
    return app.inject({ method: "POST", url: "/api/agent/chat", payload: { provider: "anthropic", model: "claude-opus-5-5", text, ...extra } });
  }

  it("looks things up, then applies additions and links at once and reports them", async () => {
    const model = scripted([
      { say: "스레드를 찾아볼게요.", actions: [{ tool: "list_threads", args: {} }], done: false },
      {
        say: "실험 설계를 졸업 프로젝트 아래에 넣고 할 일을 추가했습니다.",
        actions: [
          { tool: "link_threads", args: { fromThreadId: a, toThreadId: b, kind: "contains" } },
          { tool: "create_task", args: { title: "파일럿 계획 쓰기", due: "2026-11-20", threadId: b } }
        ],
        done: true
      }
    ]);
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: model.complete } });
    const res = await chat(app, "실험 설계는 졸업 프로젝트의 일부야. 거기에 파일럿 계획 쓰기를 20일까지로 넣어줘");
    expect(res.statusCode).toBe(200);
    const data = res.json().data;

    expect(data.message.text).toBe("실험 설계를 졸업 프로젝트 아래에 넣고 할 일을 추가했습니다.");
    expect(data.message.via).toBe("Anthropic · claude-opus-5-5");
    // 조회는 채팅에 줄로 남기지 않고, 바꾼 것만 남긴다.
    expect(data.message.steps).toEqual([
      { tool: "link_threads", ok: true, summary: `스레드 연결: #${a} —contains→ #${b}`, link: `/threads/${a}` },
      { tool: "create_task", ok: true, summary: "할 일 생성: 파일럿 계획 쓰기", link: `/threads/${b}` }
    ]);
    expect(data.message.pending).toEqual([]);
    expect(data.changed).toBe(true);
    // 이 대화에서 다룬 것: 연결한 두 스레드와 새 할 일. 이름과 상태는 지금 값을 다시 읽는다.
    expect(data.artifacts.map((x: { targetType: string; label: string; lastAction: string }) => [x.targetType, x.label, x.lastAction]).sort()).toEqual([
      ["task", "파일럿 계획 쓰기", "생성"], ["thread", "실험 설계", "연결(contains)"], ["thread", "졸업 프로젝트", "연결(contains)"]
    ]);
    expect(conn.db.select().from(threadLinks).all()).toEqual([expect.objectContaining({ fromThread: a, toThread: b, kind: "contains" })]);
    expect(conn.db.select().from(tasks).all()).toEqual([expect.objectContaining({ title: "파일럿 계획 쓰기", due: "2026-11-20", threadId: b })]);

    // 모델에는 도구 목록과 현재 시각, 그리고 두 번째 차례에 조회 결과가 주어진다.
    expect(model.seen).toHaveLength(2);
    expect(model.seen[0]!.system).toContain("link_threads");
    expect(model.seen[0]!.model).toBe("claude-opus-5-5");
    expect(model.seen[1]!.prompt).toContain("[도구 결과]");
    expect(model.seen[1]!.prompt).toContain("졸업 프로젝트");
  });

  it("parks removals until the user confirms, and does nothing when they decline", async () => {
    const [task] = conn.db.insert(tasks).values({ title: "안 할 일", threadId: a }).returning().all();
    const [ev] = conn.db.insert(events).values({ title: "취소할 모임", start: "2026-11-20T19:00:00+09:00", end: "2026-11-20T21:00:00+09:00", source: "manual" }).returning().all();
    const model = scripted([{
      say: "드롭과 취소는 확인이 필요합니다.",
      actions: [
        { tool: "drop_task", args: { id: task!.id, title: "안 할 일" } },
        { tool: "cancel_event", args: { id: ev!.id, title: "취소할 모임" } }
      ],
      done: true
    }]);
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: model.complete } });
    const data = (await chat(app, "안 할 일은 드롭하고 모임은 취소해줘")).json().data;

    expect(data.message.steps).toEqual([]);
    expect(data.changed).toBe(false);
    expect(data.message.pending.map((p: { summary: string; state: string }) => [p.summary, p.state])).toEqual([["할 일 드롭: 안 할 일", "waiting"], ["일정 취소: 취소할 모임", "waiting"]]);
    expect(conn.db.select().from(tasks).all()[0]!.status).toBe("todo");

    const [drop, cancel] = data.message.pending as Array<{ id: string }>;
    const approved = await app.inject({ method: "POST", url: "/api/agent/confirm", payload: { id: drop!.id, approve: true } });
    expect(approved.json().data).toMatchObject({ step: { tool: "drop_task", ok: true, summary: "할 일 드롭: 안 할 일" }, changed: true, conversationId: data.conversationId });
    expect(conn.db.select().from(tasks).all()[0]!.status).toBe("dropped");

    const declined = await app.inject({ method: "POST", url: "/api/agent/confirm", payload: { id: cancel!.id, approve: false } });
    expect(declined.json().data).toMatchObject({ step: { tool: "cancel_event", ok: true, summary: "하지 않음: 일정 취소: 취소할 모임" }, changed: false });
    expect(conn.db.select().from(events).all()[0]!.status).toBe("planned");

    // 저장된 대화도 화면과 같은 상태가 된다: 승인 대기가 끝나고 한 일이 줄로 남는다.
    const stored = (await app.inject({ method: "GET", url: `/api/agent/conversations/${data.conversationId}` })).json().data;
    const agentMessage = stored.messages.find((m: { role: string }) => m.role === "agent");
    expect(agentMessage.pending.map((p: { state: string }) => p.state)).toEqual(["done", "done"]);
    expect(agentMessage.steps.map((st: { summary: string }) => st.summary)).toEqual(["할 일 드롭: 안 할 일", "하지 않음: 일정 취소: 취소할 모임"]);
    expect(stored.artifacts).toEqual([expect.objectContaining({ targetType: "task", label: "안 할 일", lastAction: "드롭", status: "dropped" })]);

    // 한 번 쓴 확인은 다시 쓸 수 없다.
    expect((await app.inject({ method: "POST", url: "/api/agent/confirm", payload: { id: drop!.id, approve: true } })).statusCode).toBe(404);
  });

  it("only sees shared notes unless private access is switched on for the panel", async () => {
    const seed = buildServer(conn.db);
    await seed.inject({ method: "POST", url: "/api/notes", payload: { body: "비공개 메모" } });
    await seed.inject({ method: "POST", url: "/api/notes", payload: { body: "공개 메모", remoteVisible: true } });
    const search = () => scripted([{ say: "", actions: [{ tool: "search_notes", args: {} }], done: false }, { say: "확인했습니다.", actions: [], done: true }]);

    const closed = search();
    await chat(buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: closed.complete } }), "메모 보여줘");
    expect(closed.seen[1]!.prompt).toContain("공개 메모");
    expect(closed.seen[1]!.prompt).not.toContain("비공개 메모");
    expect(closed.seen[0]!.system).toContain("'AI 공개'로 표시한 메모만");

    const open = search();
    await chat(buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: open.complete } }), "메모 보여줘", { includePrivate: true });
    expect(open.seen[1]!.prompt).toContain("비공개 메모");

    // 공개만 모드에서는 메모를 지울 수 없다 (확인을 눌러도 거부되고 메모는 남는다).
    const del = scripted([{ say: "확인해 주세요.", actions: [{ tool: "delete_note", args: { id: 1, title: "비공개 메모" } }], done: true }]);
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: del.complete } });
    const pending = (await chat(app, "첫 메모 지워")).json().data.message.pending as Array<{ id: string }>;
    const step = (await app.inject({ method: "POST", url: "/api/agent/confirm", payload: { id: pending[0]!.id, approve: true } })).json().data.step;
    expect(step).toMatchObject({ ok: false });
    expect(step.summary).toContain("비공개 메모 접근이 꺼져 있어");
    expect((await seed.inject({ method: "GET", url: "/api/notes/1" })).statusCode).toBe(200);
  });

  it("survives a model that names unknown tools, sends bad arguments or does not answer in JSON", async () => {
    const model = scripted([
      { say: "해볼게요.", actions: [{ tool: "run_shell", args: { cmd: "rm -rf /" } }, { tool: "create_task", args: { title: "" } }], done: false },
      "죄송합니다, 그건 할 수 없습니다."
    ]);
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: model.complete } });
    const data = (await chat(app, "아무거나 해봐")).json().data;
    expect(data.message.steps.map((s: { ok: boolean; tool: string }) => [s.tool, s.ok])).toEqual([["run_shell", false], ["create_task", false]]);
    expect(data.message.text).toBe("죄송합니다, 그건 할 수 없습니다.");
    expect(data.changed).toBe(false);
    expect(conn.db.select().from(tasks).all()).toHaveLength(0);
  });

  it("stops after a bounded number of rounds, reports provider failures, and rejects remote callers", async () => {
    const looping = scripted(Array.from({ length: 10 }, () => ({ say: "계속 찾는 중", actions: [{ tool: "list_threads", args: {} }], done: false })));
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: looping.complete } });
    expect((await chat(app, "계속 찾아")).json().data.message.text).toBe("계속 찾는 중");
    expect(looping.seen).toHaveLength(5);

    const failing = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: async () => { throw new Error("응답 시간이 초과됐습니다"); } } });
    const failed = await chat(failing, "안녕");
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toEqual({ code: "PROVIDER_ERROR", message: "응답 시간이 초과됐습니다" });
    // 실패한 대화도 남는다: 사용자가 한 말과 오류.
    const kept = (await failing.inject({ method: "GET", url: `/api/agent/conversations/${failed.json().conversationId}` })).json().data;
    expect(kept.messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([["user", "안녕"], ["error", "응답 시간이 초과됐습니다"]]);

    expect((await app.inject({ method: "POST", url: "/api/agent/chat", headers: { "x-cairn-audience": "remote" }, payload: { provider: "xai", text: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/agent/conversations", headers: { "x-cairn-audience": "remote" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/agent/chat", payload: { provider: "anthropic", text: "   " } })).statusCode).toBe(400);
  });

  it("keeps conversations: a later message continues with what was said and done before", async () => {
    const model = scripted([
      { say: "할 일을 만들었습니다.", actions: [{ tool: "create_task", args: { title: "초안 쓰기" } }], done: true },
      { say: "내일로 잡았습니다.", actions: [], done: true }
    ]);
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: model.complete } });
    const first = (await chat(app, "초안 쓰기 추가해줘")).json().data;
    const second = (await chat(app, "그거 내일까지로", { conversationId: first.conversationId })).json().data;
    expect(second.conversationId).toBe(first.conversationId);
    // 두 번째 차례에 모델은 앞의 말과 실제로 한 일을 본다.
    expect(model.seen[1]!.prompt).toContain("사용자: 초안 쓰기 추가해줘");
    expect(model.seen[1]!.prompt).toContain("실행됨: 할 일 생성: 초안 쓰기");
    expect(model.seen[1]!.prompt).toContain("사용자: 그거 내일까지로");

    const list = (await app.inject({ method: "GET", url: "/api/agent/conversations" })).json().data.conversations;
    expect(list).toEqual([expect.objectContaining({ id: first.conversationId, title: "초안 쓰기 추가해줘", provider: "anthropic", model: "claude-opus-5-5" })]);
    const stored = (await app.inject({ method: "GET", url: `/api/agent/conversations/${first.conversationId}` })).json().data;
    expect(stored.messages.map((m: { role: string }) => m.role)).toEqual(["user", "agent", "user", "agent"]);

    expect((await app.inject({ method: "DELETE", url: `/api/agent/conversations/${first.conversationId}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/agent/conversations/${first.conversationId}` })).statusCode).toBe(404);
    // 대화를 지워도 만든 할 일은 남는다.
    expect(conn.db.select().from(tasks).all()).toHaveLength(1);
  });

  it("edits a note, an event and a task only after approval, showing what will change", async () => {
    const seed = buildServer(conn.db);
    const note = (await seed.inject({ method: "POST", url: "/api/notes", payload: { title: "준비물", body: "여권" } })).json().data.note;
    const [ev] = conn.db.insert(events).values({ title: "면담", start: "2026-11-20T15:00:00+09:00", end: "2026-11-20T16:00:00+09:00", source: "cairn" }).returning().all();
    const [gcal] = conn.db.insert(events).values({ title: "외부 일정", start: "2026-11-21T10:00:00+09:00", end: "2026-11-21T11:00:00+09:00", source: "gcal" }).returning().all();
    const [task] = conn.db.insert(tasks).values({ title: "보고서" }).returning().all();
    const model = scripted([{
      say: "승인해 주세요.",
      actions: [
        { tool: "update_note", args: { id: note.id, currentTitle: "준비물", body: "여권\n충전기" } },
        { tool: "update_event", args: { id: ev!.id, currentTitle: "면담", start: "2026-11-21T10:00:00+09:00", end: "2026-11-21T11:00:00+09:00" } },
        { tool: "update_event", args: { id: gcal!.id, currentTitle: "외부 일정", title: "바꾼 제목" } },
        { tool: "update_task", args: { id: task!.id, currentTitle: "보고서", due: "2026-11-25", estMinutes: 90 } }
      ],
      done: true
    }]);
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: model.complete } });
    const data = (await chat(app, "준비물에 충전기 추가, 면담은 토요일 10시로, 보고서는 25일까지 90분", { includePrivate: true })).json().data;

    // 아직 아무것도 바뀌지 않았고, 무엇이 바뀔지 보여준다.
    expect((await seed.inject({ method: "GET", url: `/api/notes/${note.id}` })).json().data.note.body).toBe("여권");
    expect(conn.db.select().from(events).all()[0]!.start).toBe("2026-11-20T15:00:00+09:00");
    const pending = data.message.pending as Array<{ id: string; summary: string; detail: string }>;
    expect(pending.map((p) => [p.summary, p.detail])).toEqual([
      ["메모 수정: 준비물", "내용 →\n여권\n충전기"],
      ["일정 수정: 면담", "시작 → 2026-11-21 10:00\n끝 → 2026-11-21 11:00"],
      ["일정 수정: 외부 일정", "제목 → 바꾼 제목"],
      ["할 일 수정: 보고서", "마감 → 2026-11-25\n예상 시간 → 90분"]
    ]);

    const results = [];
    for (const p of pending) results.push((await app.inject({ method: "POST", url: "/api/agent/confirm", payload: { id: p.id, approve: true } })).json().data);
    expect(results.map((r) => [r.step.ok, r.step.summary.slice(0, 12)])).toEqual([
      [true, "메모 수정: 준비물"], [true, "일정 수정: 면담"], [false, "일정 수정 실패: 외부"], [true, "할 일 수정: 보고서"]
    ]);
    expect((await seed.inject({ method: "GET", url: `/api/notes/${note.id}` })).json().data.note.body).toBe("여권\n충전기");
    expect(conn.db.select().from(events).all().map((e) => [e.title, e.start])).toEqual([["면담", "2026-11-21T10:00:00+09:00"], ["외부 일정", "2026-11-21T10:00:00+09:00"]]);
    expect(conn.db.select().from(tasks).all()[0]).toMatchObject({ due: "2026-11-25", estMinutes: 90 });
    // 고친 것들이 이 대화의 다룬 항목에 모인다 (실패한 외부 일정은 빼고).
    expect(results[3].artifacts.map((x: { targetType: string; label: string; lastAction: string }) => [x.targetType, x.label, x.lastAction]).sort()).toEqual([
      ["event", "면담", "시간 변경"], ["note", "준비물", "수정"], ["task", "보고서", "수정"]
    ]);
  });

  it("streams progress while the answer is being made when the browser asks for it", async () => {
    const model = scripted([
      { say: "찾아볼게요.", actions: [{ tool: "list_threads", args: {} }], done: false },
      { say: "추가했습니다.", actions: [{ tool: "create_task", args: { title: "스트림 테스트" } }], done: true }
    ]);
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: model.complete } });
    const res = await app.inject({
      method: "POST", url: "/api/agent/chat", headers: { accept: "text/event-stream" },
      payload: { provider: "anthropic", model: "claude-opus-5-5", text: "할 일 하나 추가" }
    });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const eventsSeen = res.body.split("\n\n").filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data: /, "")) as { type: string; text?: string; step?: { summary: string } });
    expect(eventsSeen.map((e) => e.type)).toEqual(["status", "say", "status", "say", "status", "step", "done"]);
    expect(eventsSeen[5]!.step!.summary).toBe("할 일 생성: 스트림 테스트");

    // 실패도 같은 흐름으로 알려준다.
    const failing = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete: async () => { throw new Error("응답 시간이 초과됐습니다"); } } });
    const failed = await failing.inject({ method: "POST", url: "/api/agent/chat", headers: { accept: "text/event-stream" }, payload: { provider: "anthropic", text: "안녕" } });
    expect(failed.body).toContain('"type":"error","message":"응답 시간이 초과됐습니다"');
  });

  it("lists the three providers with how each is reached", async () => {
    const app = buildServer(conn.db);
    const providers = (await app.inject({ method: "GET", url: "/api/agent/providers" })).json().data.providers;
    expect(providers.map((p: { id: string; via: string }) => [p.id, p.via])).toEqual([
      ["anthropic", "claude CLI (구독)"], ["openai", "codex CLI (구독)"], ["xai", "Grok 프록시"]
    ]);
    expect(providers[0].defaultModel).toBe("claude-opus-5-5");
    // 프록시(gateway) 없이 띄운 서버에서는 Grok 을 쓸 수 없다고 알려준다.
    expect(providers[2].available).toBe(false);
  });
});

describe("parseTurn", () => {
  it("reads the JSON object even when the model wraps it in prose or a code fence", () => {
    expect(parseTurn('```json\n{"say":"네","actions":[],"done":true}\n```')).toEqual({ say: "네", actions: [], done: true });
    expect(parseTurn('알겠습니다. {"say":"중괄호 } 가 든 말","actions":[{"tool":"list_threads"}]} 끝')).toEqual({
      say: "중괄호 } 가 든 말", actions: [{ tool: "list_threads", args: {} }], done: true
    });
    expect(parseTurn("그냥 글")).toBeNull();
    expect(parseTurn("{깨진 json}")).toBeNull();
  });
});
