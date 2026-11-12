import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { events, tasks, threads } from "../db/schema.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-notes-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("notes", () => {
  let conn: SqliteConnection;
  let eventId: number;
  let taskId: number;
  let threadId: number;

  beforeEach(() => {
    conn = makeTestDb();
    const [th] = conn.db.insert(threads).values({ name: "졸업 프로젝트" }).returning().all();
    threadId = th!.id;
    const [ev] = conn.db.insert(events).values({
      title: "지도교수 면담", start: "2026-03-12T15:00:00+09:00", end: "2026-03-12T16:00:00+09:00", source: "manual", threadId
    }).returning().all();
    eventId = ev!.id;
    const [tk] = conn.db.insert(tasks).values({ title: "중간 보고서 초안", due: "2026-03-20", threadId }).returning().all();
    taskId = tk!.id;
  });

  it("creates a note attached to a date and targets, and rejects empty or dangling ones", async () => {
    const app = buildServer(conn.db);
    const empty = await app.inject({ method: "POST", url: "/api/notes", payload: { body: "   " } });
    expect(empty.statusCode).toBe(400);
    const dangling = await app.inject({
      method: "POST", url: "/api/notes", payload: { body: "x", links: [{ targetType: "event", targetId: 9999 }] }
    });
    expect(dangling.statusCode).toBe(404);

    const res = await app.inject({
      method: "POST", url: "/api/notes",
      payload: {
        body: "평가 기준은 재현성 위주라고 하심",
        noteDate: "2026-03-12",
        links: [{ targetType: "event", targetId: eventId }, { targetType: "event", targetId: eventId }, { targetType: "thread", targetId: threadId }]
      }
    });
    expect(res.statusCode).toBe(201);
    const note = res.json().data.note;
    expect(note.kind).toBe("note");
    expect(note.noteDate).toBe("2026-03-12");
    expect(note.links.map((l: { targetType: string; label: string }) => [l.targetType, l.label])).toEqual([
      ["event", "지도교수 면담"], ["thread", "졸업 프로젝트"]
    ]);
  });

  it("keeps checklist item identity across edits and toggles", async () => {
    const app = buildServer(conn.db);
    const created = await app.inject({
      method: "POST", url: "/api/notes",
      payload: { kind: "checklist", title: "면담 준비", items: [{ text: "슬라이드" }, { text: "질문 목록" }], links: [{ targetType: "task", targetId: taskId }] }
    });
    const note = created.json().data.note;
    const [first, second] = note.items;

    const toggled = await app.inject({ method: "PATCH", url: `/api/notes/${note.id}/items/${first.id}`, payload: { done: true } });
    expect(toggled.statusCode).toBe(200);
    const doneAt = toggled.json().data.note.items[0].doneAt;
    expect(doneAt).toBeTruthy();

    const wrongNote = await app.inject({ method: "PATCH", url: `/api/notes/9999/items/${first.id}`, payload: { done: false } });
    expect(wrongNote.statusCode).toBe(404);

    const edited = await app.inject({
      method: "PATCH", url: `/api/notes/${note.id}`,
      payload: { items: [{ id: second.id, text: "질문 목록 (3개)" }, { id: first.id, text: "슬라이드" }, { text: "노트북 충전" }] }
    });
    const items = edited.json().data.note.items;
    expect(items.map((i: { text: string; done: boolean }) => [i.text, i.done])).toEqual([
      ["질문 목록 (3개)", false], ["슬라이드", true], ["노트북 충전", false]
    ]);
    expect(items[1].doneAt).toBe(doneAt);

    const foreign = await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { items: [{ id: 9999, text: "x" }] } });
    expect(foreign.statusCode).toBe(400);
    const after = await app.inject({ method: "GET", url: `/api/notes/${note.id}` });
    expect(after.json().data.note.items).toHaveLength(3);

    const appended = await app.inject({ method: "POST", url: `/api/notes/${note.id}/items`, payload: { text: "명함" } });
    expect(appended.json().data.note.items.map((i: { text: string }) => i.text).at(-1)).toBe("명함");

    const open = await app.inject({ method: "GET", url: "/api/notes?open=true" });
    expect(open.json().data.notes).toHaveLength(1);
  });

  it("finds notes later by text, by the attached event's name and by date", async () => {
    const app = buildServer(conn.db);
    await app.inject({
      method: "POST", url: "/api/notes",
      payload: { body: "평가 기준은 재현성 위주", links: [{ targetType: "event", targetId: eventId }] }
    });
    await app.inject({ method: "POST", url: "/api/notes", payload: { body: "장보기: 우유", noteDate: "2026-05-01" } });
    await app.inject({
      method: "POST", url: "/api/notes",
      payload: { kind: "checklist", items: [{ text: "참고문헌 정리" }], links: [{ targetType: "task", targetId: taskId }] }
    });

    const byText = await app.inject({ method: "GET", url: `/api/notes?q=${encodeURIComponent("재현성 평가")}` });
    expect(byText.json().data.notes).toHaveLength(1);

    // 메모 본문에 없는 일정 이름으로도 찾는다. 일정 자체도 related 로 돌아온다.
    const byEventName = await app.inject({ method: "GET", url: `/api/notes?q=${encodeURIComponent("면담")}` });
    const data = byEventName.json().data;
    expect(data.notes.map((n: { body: string }) => n.body)).toEqual(["평가 기준은 재현성 위주"]);
    expect(data.related).toEqual([
      expect.objectContaining({ targetType: "event", targetId: eventId, noteCount: 1, when: "2026-03-12T15:00:00+09:00" })
    ]);

    const byItem = await app.inject({ method: "GET", url: `/api/notes?q=${encodeURIComponent("참고문헌")}` });
    expect(byItem.json().data.notes).toHaveLength(1);

    // 메모 날짜가 없어도 붙은 일정(3/12)·할 일(3/20)의 날짜로 걸린다.
    const march = await app.inject({ method: "GET", url: "/api/notes?from=2026-03-01&to=2026-03-31" });
    expect(march.json().data.notes).toHaveLength(2);
    const eventDay = await app.inject({ method: "GET", url: "/api/notes?date=2026-03-12" });
    expect(eventDay.json().data.notes).toHaveLength(1);
    const may = await app.inject({ method: "GET", url: "/api/notes?date=2026-05-01" });
    expect(may.json().data.notes.map((n: { body: string }) => n.body)).toEqual(["장보기: 우유"]);

    const byTarget = await app.inject({ method: "GET", url: `/api/notes?targetType=task&targetId=${taskId}` });
    expect(byTarget.json().data.notes).toHaveLength(1);
    const halfTarget = await app.inject({ method: "GET", url: "/api/notes?targetType=task" });
    expect(halfTarget.statusCode).toBe(400);
  });

  it("archives, restores and deletes", async () => {
    const app = buildServer(conn.db);
    const created = await app.inject({ method: "POST", url: "/api/notes", payload: { body: "임시", items: [{ text: "a" }] } });
    const id = created.json().data.note.id;

    await app.inject({ method: "PATCH", url: `/api/notes/${id}`, payload: { archived: true } });
    expect((await app.inject({ method: "GET", url: "/api/notes" })).json().data.notes).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/api/notes?includeArchived=true" })).json().data.notes).toHaveLength(1);

    await app.inject({ method: "PATCH", url: `/api/notes/${id}`, payload: { archived: false, pinned: true } });
    const listed = (await app.inject({ method: "GET", url: "/api/notes" })).json().data.notes;
    expect(listed[0]).toMatchObject({ id, pinned: true, archivedAt: null });

    expect((await app.inject({ method: "DELETE", url: `/api/notes/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/notes/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/notes/${id}` })).statusCode).toBe(404);
  });

  it("offers nearby targets without a query and matching ones with a query", async () => {
    const app = buildServer(conn.db);
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    conn.db.insert(events).values({ title: "오늘 스탠드업", start: soon, source: "manual" }).run();

    const near = (await app.inject({ method: "GET", url: "/api/notes/targets" })).json().data.targets;
    expect(near.map((t: { label: string }) => t.label)).toEqual(["오늘 스탠드업", "중간 보고서 초안", "졸업 프로젝트"]);

    const searched = (await app.inject({ method: "GET", url: `/api/notes/targets?q=${encodeURIComponent("면담")}` })).json().data.targets;
    expect(searched).toEqual([expect.objectContaining({ targetType: "event", targetId: eventId, exists: true })]);
  });
});

describe("notes and remote connectors", () => {
  const REMOTE = { "x-cairn-audience": "remote" };
  let conn: SqliteConnection;
  let eventId: number;

  beforeEach(() => {
    conn = makeTestDb();
    const [ev] = conn.db.insert(events).values({
      title: "지도교수 면담", start: "2026-03-12T15:00:00+09:00", end: "2026-03-12T16:00:00+09:00", source: "manual"
    }).returning().all();
    eventId = ev!.id;
  });

  it("keeps notes private by default and shows a remote connector only the shared ones", async () => {
    const app = buildServer(conn.db);
    const link = [{ targetType: "event", targetId: eventId }];
    const secret = (await app.inject({ method: "POST", url: "/api/notes", payload: { body: "비공개 면담 메모", noteDate: "2026-03-12", links: link } })).json().data.note;
    const open = (await app.inject({ method: "POST", url: "/api/notes", payload: { body: "공개 면담 메모", noteDate: "2026-03-12", links: link, remoteVisible: true } })).json().data.note;
    expect(secret.remoteVisible).toBe(false);
    expect(open.remoteVisible).toBe(true);

    // 로컬(웹·로컬 에이전트)은 둘 다 본다.
    const local = (await app.inject({ method: "GET", url: `/api/notes?q=${encodeURIComponent("면담")}` })).json().data;
    expect(local.total).toBe(2);
    expect(local.related).toHaveLength(1);

    // 원격은 공개한 것만 보고, 비공개 메모는 개수·관련 일정의 메모 수로도 드러나지 않는다.
    const remote = (await app.inject({ method: "GET", url: `/api/notes?q=${encodeURIComponent("면담")}`, headers: REMOTE })).json().data;
    expect(remote.notes.map((n: { body: string }) => n.body)).toEqual(["공개 면담 메모"]);
    expect(remote.total).toBe(1);
    expect(remote.related).toEqual([]);

    expect((await app.inject({ method: "GET", url: `/api/notes/${secret.id}`, headers: REMOTE })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/notes/${open.id}`, headers: REMOTE })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/notes/${secret.id}` })).statusCode).toBe(200);

    // 메모가 딸려 나가는 다른 응답도 같은 규칙을 따른다.
    const eventRemote = (await app.inject({ method: "GET", url: `/api/events/${eventId}`, headers: REMOTE })).json().data;
    expect(eventRemote.notes.map((n: { id: number }) => n.id)).toEqual([open.id]);
    const eventLocal = (await app.inject({ method: "GET", url: `/api/events/${eventId}` })).json().data;
    expect(eventLocal.notes).toHaveLength(2);
    const calRemote = (await app.inject({ method: "GET", url: "/api/calendar?from=2026-03-01&to=2026-03-31", headers: REMOTE })).json().data;
    expect(calRemote.noteCounts).toEqual({ "2026-03-12": 1 });
    const calLocal = (await app.inject({ method: "GET", url: "/api/calendar?from=2026-03-01&to=2026-03-31" })).json().data;
    expect(calLocal.noteCounts).toEqual({ "2026-03-12": 2 });
    const todayUrl = `/api/today?date=2026-03-12&now=${encodeURIComponent("2026-03-12T09:00:00+09:00")}`;
    expect((await app.inject({ method: "GET", url: todayUrl, headers: REMOTE })).json().data.notes).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: todayUrl })).json().data.notes).toHaveLength(2);

    // 스위치를 끄면 바로 사라진다.
    await app.inject({ method: "PATCH", url: `/api/notes/${open.id}`, payload: { remoteVisible: false } });
    expect((await app.inject({ method: "GET", url: "/api/notes", headers: REMOTE })).json().data.total).toBe(0);
  });

  it("lets a remote connector add a note (stored as shared) but not edit, delete or browse targets", async () => {
    const app = buildServer(conn.db);
    const own = (await app.inject({ method: "POST", url: "/api/notes", payload: { body: "내 메모", remoteVisible: true } })).json().data.note;

    const created = await app.inject({
      method: "POST", url: "/api/notes", headers: REMOTE,
      payload: { body: "ChatGPT 가 받아 적은 것", remoteVisible: false, addedBy: "remote:ChatGPT" }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.note).toMatchObject({ remoteVisible: true, addedBy: "remote:ChatGPT" });

    for (const [method, url, payload] of [
      ["PATCH", `/api/notes/${own.id}`, { body: "바꿔치기" }],
      ["PATCH", `/api/notes/${own.id}`, { remoteVisible: true }],
      ["DELETE", `/api/notes/${own.id}`, undefined],
      ["POST", `/api/notes/${own.id}/items`, { text: "끼워넣기" }],
      ["GET", "/api/notes/targets", undefined]
    ] as const) {
      const res = await app.inject({ method, url, headers: REMOTE, ...(payload ? { payload } : {}) });
      expect([method, url, res.statusCode]).toEqual([method, url, 403]);
    }
    expect((await app.inject({ method: "GET", url: `/api/notes/${own.id}` })).json().data.note.body).toBe("내 메모");
  });
});
