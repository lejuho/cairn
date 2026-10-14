import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { events } from "../db/schema.js";
import { checkCandidateFeasibility } from "../services/candidate-feasibility.js";
import { findCatchUp } from "../services/event-materials.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-materials-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("event materials", () => {
  let conn: SqliteConnection;
  let eventId: number;
  beforeEach(() => {
    conn = makeTestDb();
    const [ev] = conn.db.insert(events).values({
      title: "if(kakao)26 기술 세션 DAY 2", start: "2026-10-14T10:30:00+09:00", end: "2026-10-14T16:00:00+09:00", source: "manual"
    }).returning().all();
    eventId = ev!.id;
  });

  it("attaches materials and reports the talk checklist with coverage", async () => {
    const app = buildServer(conn.db);
    const before = await app.inject({ method: "GET", url: `/api/events/${eventId}/capture-check` });
    expect(before.json().data.profile).toBe("talk");
    expect(before.json().data.items.map((i: { kind: string; covered: unknown }) => [i.kind, i.covered])).toEqual([
      ["slides", null], ["video", null], ["notes", null]
    ]);

    const noUrl = await app.inject({ method: "POST", url: `/api/events/${eventId}/materials`, payload: { kind: "slides" } });
    expect(noUrl.statusCode).toBe(400);
    const noDate = await app.inject({ method: "POST", url: `/api/events/${eventId}/materials`, payload: { kind: "video", status: "expected" } });
    expect(noDate.statusCode).toBe(400);
    const missingEvent = await app.inject({ method: "POST", url: "/api/events/9999/materials", payload: { kind: "notes", note: "x" } });
    expect(missingEvent.statusCode).toBe(404);

    const slides = await app.inject({
      method: "POST", url: `/api/events/${eventId}/materials`,
      payload: { kind: "slides", label: "카나나 세션", url: "https://if.kakao.com/2026/session/1" }
    });
    expect(slides.statusCode).toBe(201);
    await app.inject({
      method: "POST", url: `/api/events/${eventId}/materials`,
      payload: { kind: "video", status: "expected", expectedAt: "2026-10-31T10:00:00+09:00", sourceUrl: "https://www.youtube.com/@kakaotech" }
    });

    const after = await app.inject({ method: "GET", url: `/api/events/${eventId}/capture-check` });
    expect(after.json().data.items.map((i: { covered: unknown }) => i.covered)).toEqual(["available", "expected", null]);
    expect(after.json().data.materials).toHaveLength(2);
  });

  it("asks when an expected material is due and resolves it from the answer", async () => {
    const app = buildServer(conn.db);
    const created = await app.inject({
      method: "POST", url: `/api/events/${eventId}/materials`,
      payload: { kind: "video", status: "expected", expectedAt: "2026-10-31T10:00:00+09:00", sourceUrl: "https://www.youtube.com/@kakaotech" }
    });
    const materialId = created.json().data.material.id;

    expect(created.json().data.material.expectedAt).toBe("2026-10-31T01:00:00.000Z");
    // 같은 날 오전 9시(KST) = 00:00Z — 오프셋이 섞여도 아직 이르다고 판단해야 한다.
    const early = await app.inject({ method: "GET", url: `/api/inbox?now=${encodeURIComponent("2026-10-31T00:00:00Z")}` });
    expect(early.json().data.items.filter((i: { kind: string }) => i.kind === "material_due")).toHaveLength(0);

    const due = await app.inject({ method: "GET", url: `/api/inbox?now=${encodeURIComponent("2026-10-31T12:00:00+09:00")}` });
    const item = due.json().data.items.find((i: { kind: string }) => i.kind === "material_due");
    expect(item).toMatchObject({ subject: { type: "material", id: materialId } });

    // 아직이면 다음 확인 시점으로 미룬다 → 그 시점에 새 질문.
    const later = await app.inject({
      method: "POST", url: `/api/inbox/${item.id}/answer`,
      payload: { decision: "accept", value: { expectedAt: "2026-11-07T10:00:00+09:00" } }
    });
    expect(later.json().data.effect.material).toMatchObject({ status: "expected", expectedAt: "2026-11-07T01:00:00.000Z" });

    const due2 = await app.inject({ method: "GET", url: `/api/inbox?now=${encodeURIComponent("2026-11-08T12:00:00+09:00")}` });
    const item2 = due2.json().data.items.find((i: { kind: string }) => i.kind === "material_due");
    expect(item2.id).not.toBe(item.id);
    const done = await app.inject({
      method: "POST", url: `/api/inbox/${item2.id}/answer`,
      payload: { decision: "accept", value: { url: "https://www.youtube.com/watch?v=abc" } }
    });
    expect(done.json().data.effect.material).toMatchObject({ status: "available", url: "https://www.youtube.com/watch?v=abc", expectedAt: null });
  });

  it("returns the open checklist when a talk outcome is recorded as done", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/inbox?now=${encodeURIComponent("2026-10-14T17:00:00+09:00")}` });
    const item = res.json().data.items.find((i: { kind: string }) => i.kind === "outcome_check");
    const ok = await app.inject({ method: "POST", url: `/api/inbox/${item.id}/answer`, payload: { decision: "accept", value: { outcome: "done" } } });
    expect(ok.json().data.effect.captureCheck).toMatchObject({ profile: "talk" });
    expect(ok.json().data.effect.captureCheck.items).toHaveLength(3);
  });

  it("treats a conflicting event with a replay as recoverable", async () => {
    const app = buildServer(conn.db);
    const input = { title: "친구 점심", start: "2026-10-14T12:00:00+09:00", end: "2026-10-14T13:00:00+09:00" };
    const now = "2026-10-01T09:00:00+09:00";
    const before = await checkCandidateFeasibility(conn.db, undefined, input, now);
    const conflictBefore = before.risks.find((r) => r.type === "conflict")!;
    expect(conflictBefore.text).not.toMatch(/다시보기/);

    await app.inject({
      method: "POST", url: `/api/events/${eventId}/materials`,
      payload: { kind: "video", status: "expected", expectedAt: "2026-10-31T10:00:00+09:00", sourceUrl: "https://www.youtube.com/@kakaotech" }
    });
    const after = await checkCandidateFeasibility(conn.db, undefined, input, now);
    expect(after.risks.find((r) => r.type === "conflict")!.text).toMatch(/다시보기가 공개될 예정/);
    expect(after.verdict).not.toBe("hard");
  });

  it("suggests giving up the event with a replay in a cost-free conflict", async () => {
    const [other] = conn.db.insert(events).values({
      title: "스터디", start: "2026-10-14T11:00:00+09:00", end: "2026-10-14T12:00:00+09:00", source: "manual"
    }).returning().all();
    const app = buildServer(conn.db);
    const url = `/api/decisions/conflicts?date=2026-10-14&now=${encodeURIComponent("2026-10-14T08:00:00+09:00")}`;
    const neutral = (await app.inject({ method: "GET", url })).json().data.conflicts[0];
    expect(neutral.options.map((o: { suggested: boolean }) => o.suggested)).toEqual([false, false]);

    await app.inject({
      method: "POST", url: `/api/events/${eventId}/materials`,
      payload: { kind: "video", url: "https://www.youtube.com/watch?v=abc" }
    });
    const res = (await app.inject({ method: "GET", url })).json().data.conflicts[0];
    const kakao = res.options.find((o: { event: { id: number } }) => o.event.id === eventId);
    const study = res.options.find((o: { event: { id: number } }) => o.event.id === other!.id);
    expect(kakao).toMatchObject({ suggested: true, catchUp: "available", reasonCodes: ["lower_cancel_cost", "catch_up_available"] });
    expect(study).toMatchObject({ suggested: false, catchUp: null });
  });

  it("auto-expires unconfirmed materials per kind and stops discounting them", async () => {
    const app = buildServer(conn.db);
    const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/events/${eventId}/materials`, payload });
    const slides = (await post({ kind: "slides", status: "expected", expectedAt: "2026-10-15T10:00:00+09:00" })).json().data.material;
    const video = (await post({ kind: "video", status: "expected", expectedAt: "2026-10-15T10:00:00+09:00" })).json().data.material;
    const list = async (now: string) => {
      await app.inject({ method: "GET", url: `/api/inbox?now=${encodeURIComponent(now)}` });
      const ms = (await app.inject({ method: "GET", url: `/api/events/${eventId}/materials` })).json().data.materials;
      return Object.fromEntries(ms.map((m: { id: number; status: string; missingReason: string | null }) => [m.id, [m.status, m.missingReason]]));
    };

    // 13일째: 둘 다 아직 기다린다. 15일째: 문서만 정리, 영상은 30일까지.
    expect(await list("2026-10-28T12:00:00+09:00")).toEqual({ [slides.id]: ["expected", null], [video.id]: ["expected", null] });
    expect(await list("2026-10-30T12:00:00+09:00")).toEqual({ [slides.id]: ["missing", "auto_expired"], [video.id]: ["expected", null] });
    expect(findCatchUp(conn.db, [eventId], "2026-11-10T12:00:00+09:00").get(eventId)).toBe("expected");
    // 영상 유예가 지나면, 정리 배치 전이라도 비용 할인 근거에서 빠진다.
    expect(findCatchUp(conn.db, [eventId], "2026-11-15T12:00:00+09:00").has(eventId)).toBe(false);
    expect(await list("2026-11-15T12:00:00+09:00")).toEqual({ [slides.id]: ["missing", "auto_expired"], [video.id]: ["missing", "auto_expired"] });
    const pendingDue = (await app.inject({ method: "GET", url: `/api/inbox?now=${encodeURIComponent("2026-11-15T12:00:00+09:00")}` }))
      .json().data.items.filter((i: { kind: string }) => i.kind === "material_due");
    expect(pendingDue).toHaveLength(0);

    // 직접 확인한 미공개는 confirmed, 다시 공개되면 사유가 지워진다.
    const confirmed = await app.inject({ method: "PATCH", url: `/api/materials/${slides.id}`, payload: { status: "missing" } });
    expect(confirmed.json().data.material.missingReason).toBe("confirmed");
    const back = await app.inject({ method: "PATCH", url: `/api/materials/${slides.id}`, payload: { status: "available", url: "https://if.kakao.com/2026/s.pdf" } });
    expect(back.json().data.material.missingReason).toBeNull();
  });
});
