import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { events, inboxItems, threads } from "../db/schema.js";
import { extractPhoneCandidates, proposeWorkspaceLinks } from "../jobs/observation-extractor.js";
import type { LlmGateway } from "../llm/gateway.js";

const NOW = "2026-10-14T12:00:00+09:00";
const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-inbox-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function fakeGateway(content: string): LlmGateway {
  return {
    chatCompletionsUrl: new URL("http://fake/v1/chat/completions"),
    completeChat: async () => ({
      ok: true,
      data: {
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "fake",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }]
      }
    })
  } as unknown as LlmGateway;
}

describe("agent inbox", () => {
  let conn: SqliteConnection;
  beforeEach(() => {
    conn = makeTestDb();
  });

  function inbox(query = "") {
    const app = buildServer(conn.db);
    return app.inject({ method: "GET", url: `/api/inbox?now=${encodeURIComponent(NOW)}${query}` });
  }

  it("asks for the outcome of a recently ended timed event and records the answer", async () => {
    const [ev] = conn.db.insert(events).values({
      title: "치과", start: "2026-10-14T09:00:00+09:00", end: "2026-10-14T10:00:00+09:00", source: "cairn", selfImposed: 1
    }).returning().all();
    // 종일 일정은 결과를 묻지 않는다.
    conn.db.insert(events).values({
      title: "생일", start: "2026-10-14T00:00:00+09:00", end: "2026-10-15T00:00:00+09:00", source: "gcal"
    }).run();

    const res = await inbox();
    const items = res.json().data.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "outcome_check", subject: { type: "event", id: ev!.id } });

    const app = buildServer(conn.db);
    const bad = await app.inject({ method: "POST", url: `/api/inbox/${items[0].id}/answer`, payload: { decision: "accept" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST", url: `/api/inbox/${items[0].id}/answer`,
      payload: { decision: "accept", value: { outcome: "done" }, note: "잘 다녀옴", answeredBy: "test" }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.effect).toMatchObject({ annotatedEventId: ev!.id, outcome: "done" });

    // 답한 질문은 다시 materialize 되어도 살아나지 않는다.
    expect((await inbox()).json().data.items).toHaveLength(0);
    const again = await app.inject({ method: "POST", url: `/api/inbox/${items[0].id}/answer`, payload: { decision: "dismiss" } });
    expect(again.statusCode).toBe(409);
  });

  it("ranks items of the thread mapped to the cwd above global ones", async () => {
    const [a] = conn.db.insert(threads).values({ name: "포트폴리오", deadline: "2026-10-20" }).returning().all();
    const [b] = conn.db.insert(threads).values({ name: "BAY", deadline: "2026-10-16" }).returning().all();
    const app = buildServer(conn.db);
    await app.inject({ method: "POST", url: "/api/thread-workspaces", payload: { threadId: a!.id, path: "/home/pi/portfolio/" } });

    const global = (await inbox()).json().data.items;
    expect(global[0].threadId).toBe(b!.id);
    const scoped = (await inbox(`&cwd=${encodeURIComponent("/home/pi/portfolio/web")}`)).json().data.items;
    expect(scoped[0]).toMatchObject({ threadId: a!.id, relevance: "workspace", kind: "deadline" });
  });

  it("snoozed items disappear until the snooze ends", async () => {
    conn.db.insert(threads).values({ name: "마감", deadline: "2026-10-15" }).run();
    const app = buildServer(conn.db);
    const [item] = (await inbox()).json().data.items;
    await app.inject({ method: "POST", url: `/api/inbox/${item.id}/answer`, payload: { decision: "snooze", snoozeHours: 2 } });
    const row = conn.db.select().from(inboxItems).all()[0]!;
    expect(row.status).toBe("pending");
    expect(row.snoozedUntil).not.toBeNull();
  });

  it("guards observation ingest with the token and drops OTP notifications", async () => {
    const app = buildServer(conn.db, undefined, undefined, undefined, { ingestToken: "secret" });
    const payload = { source: "phone_notification", sourceRef: "n1", app: "com.kakao.talk", title: "민수", body: "내일 7시 강남역 ㄱㄱ" };
    expect((await app.inject({ method: "POST", url: "/api/observations", payload })).statusCode).toBe(401);
    const headers = { authorization: "Bearer secret" };
    const first = await app.inject({ method: "POST", url: "/api/observations", payload, headers });
    expect(first.json().data).toMatchObject({ stored: true });
    const dup = await app.inject({ method: "POST", url: "/api/observations", payload, headers });
    expect(dup.json().data).toEqual({ stored: false, reason: "duplicate" });
    const otp = await app.inject({
      method: "POST", url: "/api/observations", headers,
      payload: { source: "phone_notification", sourceRef: "n2", title: "[Web발신]", body: "인증번호 [482913]를 입력해주세요" }
    });
    expect(otp.json().data).toEqual({ stored: false, reason: "filtered" });
  });

  it("accepts form-encoded phone notifications", async () => {
    const app = buildServer(conn.db, undefined, undefined, undefined, { ingestToken: "t" });
    const res = await app.inject({
      method: "POST", url: "/api/observations",
      headers: { authorization: "Bearer t", "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ source: "phone_notification", app: "카카오톡", title: "지수", body: "금요일 \"7시\"\n신촌" }).toString()
    });
    expect(res.json().data).toMatchObject({ stored: true });
  });

  it("turns phone notifications into event candidates that create an event on accept", async () => {
    const app = buildServer(conn.db, undefined, undefined, undefined, { ingestToken: "t" });
    const res = await app.inject({
      method: "POST", url: "/api/observations", headers: { authorization: "Bearer t" },
      payload: { source: "phone_notification", sourceRef: "k1", app: "com.kakao.talk", title: "민수", body: "내일 7시 강남역 ㄱㄱ", occurredAt: NOW }
    });
    const obsId = res.json().data.id as number;
    const llm = JSON.stringify([{ obs: [obsId, 999], title: "민수 약속", start: "2026-10-15T19:00:00+09:00", end: null, location: "강남역", confidence: 0.8, reason: "카톡" }]);
    const out = await extractPhoneCandidates(conn.db, fakeGateway(`\`\`\`json\n${llm}\n\`\`\``), "2026-10-14T03:00:00Z");
    expect(out).toEqual({ processed: 1, candidates: 1 });

    const [item] = (await inbox()).json().data.items;
    expect(item).toMatchObject({ kind: "event_candidate", evidence: [{ observationId: obsId }] });
    const ans = await app.inject({ method: "POST", url: `/api/inbox/${item.id}/answer`, payload: { decision: "accept" } });
    const created = conn.db.select().from(events).all();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: "민수 약속", location: "강남역", source: "manual", selfImposed: 0 });
    expect(ans.json().data.effect.createdEventId).toBe(created[0]!.id);
    // 이미 처리된 관찰은 다시 보내지 않는다.
    expect(await extractPhoneCandidates(conn.db, fakeGateway("[]"), "2026-10-14T03:10:00Z")).toEqual({ processed: 0, candidates: 0 });
  });

  it("asks which thread an unmapped session workspace belongs to and maps it on accept", async () => {
    const [t] = conn.db.insert(threads).values({ name: "포트폴리오" }).returning().all();
    const app = buildServer(conn.db);
    for (const [ref, cwd] of [["s1", "/home/pi/portfolio"], ["s2", "/home/pi"], ["s3", "/home/pi/portfolio"]]) {
      await app.inject({ method: "POST", url: "/api/observations", payload: { source: "claude_session", sourceRef: ref, cwd } });
    }
    expect(proposeWorkspaceLinks(conn.db, NOW)).toBe(1);
    const [item] = (await inbox()).json().data.items;
    expect(item.kind).toBe("thread_link");
    const ans = await app.inject({ method: "POST", url: `/api/inbox/${item.id}/answer`, payload: { decision: "accept", value: { threadId: t!.id } } });
    expect(ans.json().data.effect).toMatchObject({ threadId: t!.id, workspace: "/home/pi/portfolio" });

    const ctx = await app.inject({ method: "GET", url: `/api/context/now?now=${encodeURIComponent(NOW)}&cwd=/home/pi/portfolio` });
    expect(ctx.json().data.activeThreads[0]).toMatchObject({ id: t!.id, matchesWorkspace: true });
  });
});
