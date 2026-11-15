import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import type { CompleteInput } from "../agent/providers.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { cleanFileName } from "../services/files.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-files-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

function storedFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
}

describe("note attachments", () => {
  let conn: SqliteConnection;
  let dir: string;
  const previous = process.env.CAIRN_FILES_DIR;

  beforeEach(() => {
    conn = makeTestDb();
    dir = mkdtempSync(join(tmpdir(), "cairn-files-store-"));
    tempDirs.push(dir);
    process.env.CAIRN_FILES_DIR = dir;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.CAIRN_FILES_DIR;
    else process.env.CAIRN_FILES_DIR = previous;
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function note(app: ReturnType<typeof buildServer>, payload: Record<string, unknown>): Promise<number> {
    return (await app.inject({ method: "POST", url: "/api/notes", payload })).json().data.note.id;
  }

  function upload(app: ReturnType<typeof buildServer>, noteId: number, name: string, type: string, body: string | Buffer, headers: Record<string, string> = {}) {
    return app.inject({
      method: "POST", url: `/api/notes/${noteId}/files`,
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name), "x-file-type": type, ...headers },
      payload: Buffer.isBuffer(body) ? body : Buffer.from(body)
    });
  }

  it("stores an upload on disk once, shows it on the note, serves it back and cleans up", async () => {
    const app = buildServer(conn.db);
    const first = await note(app, { body: "회의 자료" });
    const second = await note(app, { body: "같은 자료를 쓰는 다른 메모" });

    const res = await upload(app, first, "../회의 안건.txt", "text/plain", "1. 예산\n2. 일정");
    expect(res.statusCode).toBe(201);
    const [att] = res.json().data.note.attachments;
    expect(att).toEqual({ id: 1, kind: "file", name: "회의 안건.txt", url: "/api/files/1", fileId: 1, mime: "text/plain", size: 19 });

    // 같은 내용은 한 번만 저장된다.
    await upload(app, second, "agenda-copy.txt", "text/plain", "1. 예산\n2. 일정");
    expect(storedFiles(dir)).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/api/notes/${second}` })).json().data.note.attachments[0]).toMatchObject({ name: "agenda-copy.txt", fileId: 1 });

    // 글 파일은 화면에서 실행되지 않도록 내려받기로만 준다.
    const got = await app.inject({ method: "GET", url: "/api/files/1" });
    expect(got.statusCode).toBe(200);
    expect(got.body).toBe("1. 예산\n2. 일정");
    expect(got.headers["content-type"]).toBe("application/octet-stream");
    expect(got.headers["content-disposition"]).toContain("attachment");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");

    // 파일 이름으로도 메모를 찾는다.
    expect((await app.inject({ method: "GET", url: `/api/notes?q=${encodeURIComponent("안건")}` })).json().data.notes.map((n: { id: number }) => n.id)).toEqual([first]);

    // 한 메모에서 떼어도 다른 메모가 쓰고 있으면 남고, 마지막 메모가 지워지면 디스크에서도 사라진다.
    expect((await app.inject({ method: "DELETE", url: `/api/notes/${first}/attachments/${att.id}` })).json().data.note.attachments).toEqual([]);
    expect(storedFiles(dir)).toHaveLength(1);
    await app.inject({ method: "DELETE", url: `/api/notes/${second}` });
    expect(storedFiles(dir)).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/api/files/1" })).statusCode).toBe(404);
  });

  it("shows images and PDFs in the browser, and never serves HTML as a page", async () => {
    const app = buildServer(conn.db);
    const id = await note(app, { body: "사진" });
    await upload(app, id, "photo.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await upload(app, id, "page.html", "text/html", "<script>alert(1)</script>");
    const image = await app.inject({ method: "GET", url: "/api/files/1" });
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["content-disposition"]).toContain("inline");
    const html = await app.inject({ method: "GET", url: "/api/files/2" });
    expect(html.headers["content-type"]).toBe("application/octet-stream");
    expect(html.headers["content-disposition"]).toContain("attachment");
  });

  it("attaches links for anything too big to upload, and refuses what is not a web address", async () => {
    const app = buildServer(conn.db);
    const id = await note(app, { body: "녹화본" });
    const res = await app.inject({ method: "POST", url: `/api/notes/${id}/links`, payload: { url: "https://drive.google.com/file/d/abc/view", name: "세션 녹화본" } });
    expect(res.json().data.note.attachments).toEqual([{ id: 1, kind: "link", name: "세션 녹화본", url: "https://drive.google.com/file/d/abc/view", fileId: null, mime: null, size: null }]);
    expect((await app.inject({ method: "POST", url: `/api/notes/${id}/links`, payload: { url: "javascript:alert(1)" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/notes/${id}/links`, payload: { url: "https://example.com/a/b" } })).json().data.note.attachments[1].name).toBe("example.com/a/b");
    expect((await upload(app, id, "empty.txt", "text/plain", "")).statusCode).toBe(400);
    expect((await upload(app, 9999, "a.txt", "text/plain", "x")).statusCode).toBe(404);
  });

  it("keeps files of private notes from remote connectors", async () => {
    const app = buildServer(conn.db);
    const secret = await note(app, { body: "비공개" });
    const shared = await note(app, { body: "공개", remoteVisible: true });
    await upload(app, secret, "secret.txt", "text/plain", "비밀");
    await upload(app, shared, "shared.txt", "text/plain", "공개 자료");
    const remote = { "x-cairn-audience": "remote" };
    expect((await app.inject({ method: "GET", url: "/api/files/1", headers: remote })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/files/2", headers: remote })).statusCode).toBe(200);
    expect((await upload(app, shared, "more.txt", "text/plain", "x", remote)).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/notes/${shared}/attachments/2`, headers: remote })).statusCode).toBe(403);
  });

  it("lets the agent see file names always, and read contents only when files are switched on", async () => {
    const seen: CompleteInput[] = [];
    const replies = [
      { say: "찾아볼게요.", actions: [{ tool: "search_notes", args: { q: "회의" } }], done: false },
      { say: "읽어볼게요.", actions: [{ tool: "read_file", args: { fileId: 1 } }], done: false },
      { say: "끝.", actions: [], done: true }
    ];
    const queue = [...replies, ...replies];
    const complete = async (input: CompleteInput) => {
      seen.push(input);
      return JSON.stringify(queue.shift());
    };
    const app = buildServer(conn.db, undefined, undefined, undefined, { agent: { complete, mail: null, sheets: null, reason: null } });
    const id = await note(app, { body: "회의 자료" });
    await upload(app, id, "agenda.txt", "text/plain", "1. 예산 확정\n2. 일정 조율");
    const chat = (extra: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/agent/chat", payload: { provider: "anthropic", text: "회의 자료 내용 알려줘", includePrivate: true, ...extra } });

    const off = (await chat({})).json().data;
    expect(seen[0]!.system).not.toContain("read_file");
    expect(seen[1]!.prompt).toContain("agenda.txt");
    expect(off.message.steps).toEqual([{ tool: "read_file", ok: false, summary: "파일 읽기가 꺼져 있습니다" }]);
    expect(seen[2]!.prompt).not.toContain("예산 확정");

    await chat({ includeFiles: true });
    expect(seen[3]!.system).toContain("read_file");
    expect(seen[5]!.prompt).toContain("예산 확정");
  });
});

describe("files sent in the agent chat", () => {
  let conn: SqliteConnection;
  let dir: string;
  const previous = process.env.CAIRN_FILES_DIR;

  beforeEach(() => {
    conn = makeTestDb();
    dir = mkdtempSync(join(tmpdir(), "cairn-files-store-"));
    tempDirs.push(dir);
    process.env.CAIRN_FILES_DIR = dir;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.CAIRN_FILES_DIR;
    else process.env.CAIRN_FILES_DIR = previous;
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  function server(replies: object[]) {
    const seen: CompleteInput[] = [];
    const complete = async (input: CompleteInput) => {
      seen.push(input);
      return JSON.stringify(replies.shift());
    };
    return { app: buildServer(conn.db, undefined, undefined, undefined, { agent: { complete, mail: null, sheets: null, reason: null } }), seen };
  }

  async function send(app: ReturnType<typeof buildServer>, name: string, body: string): Promise<number> {
    const res = await app.inject({ method: "POST", url: "/api/agent/uploads", headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name), "x-file-type": "text/plain" }, payload: Buffer.from(body) });
    expect(res.statusCode).toBe(201);
    return res.json().data.fileId;
  }

  const chat = (app: ReturnType<typeof buildServer>, text: string, uploads: number[]) =>
    app.inject({ method: "POST", url: "/api/agent/chat", payload: { provider: "anthropic", text, includePrivate: true, uploads } });

  it("puts one file on an existing note and another on a new one, as the model decides", async () => {
    const { app, seen } = server([
      { say: "맞는 메모를 찾아볼게요.", actions: [{ tool: "search_notes", args: { q: "온보딩" } }], done: false },
      {
        say: "슬라이드는 온보딩 메모에 붙이고, 영수증은 새 메모로 만들었습니다.",
        actions: [
          { tool: "attach_file", args: { noteId: 1, fileId: 1 } },
          { tool: "create_note", args: { title: "11월 회식 영수증", body: "채팅에서 올림", fileIds: [2] } },
          { tool: "attach_file", args: { noteId: 1, fileId: 77 } }
        ],
        done: true
      }
    ]);
    await app.inject({ method: "POST", url: "/api/notes", payload: { title: "온보딩 콜 자료", body: "발표 준비" } });
    const slides = await send(app, "온보딩 슬라이드.txt", "슬라이드 내용");
    const receipt = await send(app, "영수증.txt", "42,000원");

    const data = (await chat(app, "슬라이드는 온보딩 메모에 붙이고 영수증은 따로 정리해줘", [slides, receipt])).json().data;
    expect(seen[0]!.prompt).toContain("[이번에 올라온 파일]");
    expect(seen[0]!.prompt).toContain("온보딩 슬라이드.txt");
    expect(data.message.steps.map((s: { tool: string; ok: boolean; summary: string }) => [s.tool, s.ok, s.summary])).toEqual([
      ["attach_file", true, "파일 붙임: 온보딩 슬라이드.txt → 온보딩 콜 자료"],
      ["create_note", true, "메모 저장: 11월 회식 영수증 (파일 1개 붙임)"],
      ["attach_file", false, "이번에 올라온 파일이 아닙니다: #77"]
    ]);
    const notes = (await app.inject({ method: "GET", url: "/api/notes" })).json().data.notes as Array<{ title: string; attachments: Array<{ name: string }> }>;
    expect(notes.map((n) => [n.title, n.attachments.map((a) => a.name)]).sort()).toEqual([
      ["11월 회식 영수증", ["영수증.txt"]], ["온보딩 콜 자료", ["온보딩 슬라이드.txt"]]
    ]);
  });

  it("never loses a file: what the model did not place goes on a new note", async () => {
    const { app } = server([{ say: "네, 받았습니다.", actions: [], done: true }]);
    const one = await send(app, "회의록.txt", "결정 사항");
    const data = (await chat(app, "이거 보관해줘", [one])).json().data;
    expect(data.message.steps).toEqual([{ tool: "attach_file", ok: true, summary: "파일 1개를 새 메모에 담음: 회의록.txt", link: "/notes" }]);
    expect(data.changed).toBe(true);
    const notes = (await app.inject({ method: "GET", url: "/api/notes" })).json().data.notes;
    expect(notes).toEqual([expect.objectContaining({ title: "회의록.txt", body: "이거 보관해줘", remoteVisible: false, attachments: [expect.objectContaining({ name: "회의록.txt", kind: "file" })] })]);
    // 이미 붙은 파일은 다음 말에 다시 실어도 또 붙지 않는다.
    const again = server([{ say: "네.", actions: [], done: true }]);
    expect((await chat(again.app, "한 번 더", [one])).json().data.message.steps).toEqual([]);
  });
});

describe("cleanFileName", () => {
  it("keeps only the last path part and drops control characters", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("C:\\Users\\me\\보고서.pdf")).toBe("보고서.pdf");
    expect(cleanFileName("a\u0000b.txt")).toBe("ab.txt");
    expect(cleanFileName("")).toBe("파일");
  });
});
