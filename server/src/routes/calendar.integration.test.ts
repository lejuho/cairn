import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { events, tasks } from "../db/schema.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-calendar-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("GET /api/calendar", () => {
  let conn: SqliteConnection;
  beforeEach(() => {
    conn = makeTestDb();
    conn.db.insert(events).values([
      { title: "면담", start: "2026-03-12T15:00:00+09:00", end: "2026-03-12T16:00:00+09:00", source: "manual" },
      { title: "2월 마지막 밤", start: "2026-02-28T22:00:00+09:00", end: "2026-02-28T23:30:00+09:00", source: "manual" },
      // 3/1 00:30 KST 에 끝나므로 3월에도 걸친다.
      { title: "자정 넘는 모임", start: "2026-02-28T23:00:00+09:00", end: "2026-03-01T00:30:00+09:00", source: "manual" },
      // 종일 일정: 끝이 다음 날 자정(포함 안 함)이라 4/1 에는 걸리지 않는다.
      { title: "3월 말 종일", start: "2026-03-31T00:00:00+09:00", end: "2026-04-01T00:00:00+09:00", source: "manual", type: "all_day" },
      { title: "4월 첫날", start: "2026-04-01T00:00:00+09:00", end: "2026-04-02T00:00:00+09:00", source: "manual", type: "all_day" },
      { title: "취소된 것", start: "2026-03-05T10:00:00+09:00", end: "2026-03-05T11:00:00+09:00", source: "manual", status: "cancelled" }
    ]).run();
    conn.db.insert(tasks).values([
      { title: "보고서", due: "2026-03-20" },
      { title: "끝난 일", due: "2026-03-21", status: "done" },
      { title: "안 하기로 한 일", due: "2026-03-22", status: "dropped" },
      { title: "4월 일", due: "2026-04-02" },
      { title: "마감 없음" }
    ]).run();
  });

  it("returns the range's events, open due tasks and per-day note counts in local time", async () => {
    const app = buildServer(conn.db);
    const [meeting] = conn.db.select().from(events).all();
    await app.inject({ method: "POST", url: "/api/notes", payload: { body: "a", noteDate: "2026-03-12" } });
    await app.inject({ method: "POST", url: "/api/notes", payload: { body: "b", links: [{ targetType: "event", targetId: meeting!.id }] } });
    await app.inject({ method: "POST", url: "/api/notes", payload: { body: "c", noteDate: "2026-03-01" } });
    await app.inject({ method: "POST", url: "/api/notes", payload: { body: "d", noteDate: "2026-04-01" } });

    const res = await app.inject({ method: "GET", url: "/api/calendar?from=2026-03-01&to=2026-03-31" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.timeZone).toBe("Asia/Seoul");
    expect(data.events.map((e: { title: string }) => e.title)).toEqual(["자정 넘는 모임", "면담", "3월 말 종일"]);
    // 끝낸 할 일도 마감일에 남고, 드롭한 것은 빠진다.
    expect(data.tasks.map((t: { title: string; status: string }) => [t.title, t.status])).toEqual([["보고서", "todo"], ["끝난 일", "done"]]);
    expect(data.noteCounts).toEqual({ "2026-03-01": 1, "2026-03-12": 2 });
  });

  it("rejects malformed, reversed and oversized ranges", async () => {
    const app = buildServer(conn.db);
    for (const url of [
      "/api/calendar",
      "/api/calendar?from=2026-03-01",
      "/api/calendar?from=2026-3-1&to=2026-03-31",
      "/api/calendar?from=2026-03-31&to=2026-03-01",
      "/api/calendar?from=2026-01-01&to=2026-12-31"
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: "/api/calendar?from=2026-03-01&to=2026-03-01" })).statusCode).toBe(200);
  });

  it("records an outcome in one step and reports it so the event is not asked about again", async () => {
    const app = buildServer(conn.db);
    const meeting = conn.db.select().from(events).all().find((e) => e.title === "면담")!;

    expect((await app.inject({ method: "POST", url: `/api/events/${meeting.id}/outcome`, payload: { outcome: "skipped" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/events/9999/outcome", payload: { outcome: "done" } })).statusCode).toBe(404);
    const before = (await app.inject({ method: "GET", url: "/api/calendar?from=2026-03-01&to=2026-03-31" })).json().data;
    expect(before.outcomeRecordedEventIds).toEqual([]);

    const res = await app.inject({ method: "POST", url: `/api/events/${meeting.id}/outcome`, payload: { outcome: "moved", reasonText: "교수님 출장" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.event.status).toBe("moved");
    expect(res.json().data.annotations).toEqual([expect.objectContaining({ eventId: meeting.id, outcome: "moved", reasonText: "교수님 출장" })]);

    // 거울(이동·취소 원장)이 이 기록을 읽는다.
    const mirror = (await app.inject({ method: "GET", url: "/api/mirror/ledger" })).json();
    expect(JSON.stringify(mirror)).toContain("면담");

    // 외부 캘린더 동기화가 상태를 되돌려도 기록된 일정으로 남는다.
    conn.sqlite.prepare("UPDATE events SET status = 'planned' WHERE id = ?").run(meeting.id);
    const after = (await app.inject({ method: "GET", url: "/api/calendar?from=2026-03-01&to=2026-03-31" })).json().data;
    expect(after.outcomeRecordedEventIds).toEqual([meeting.id]);
  });
});
