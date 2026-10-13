import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { events, inboxItems } from "../db/schema.js";
import type { MapGateway } from "../maps/gateway.js";
import { checkCandidateFeasibility } from "../services/candidate-feasibility.js";

const NOW = "2026-10-14T09:00:00+09:00";
const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-cand-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const COORDS: Record<string, [number, number]> = {
  "홍익대학교 서울캠퍼스": [37.5507, 126.9254],
  "코엑스": [37.5116, 127.0591],
  "강남역": [37.4979, 127.0276],
  "신촌역": [37.5552, 126.9369]
};

// 도착 시각과 함께 호출됐는지 기록하는 가짜 지도 gateway. 소요시간 = 좌표 거리 기반 고정값.
function fakeMap(minutes: number, calls: { arrivalTime?: number }[] = []): MapGateway {
  return {
    provider: "google",
    smoke: async () => ({ ok: true, data: {} }) as never,
    geocodeAddress: async (address: string) => {
      const c = COORDS[address];
      return c
        ? { ok: true, outcome: { status: "resolved", latitude: c[0], longitude: c[1], displayLabel: address, providerResultId: null, confidence: "high", providerStatus: "OK", uncertainty: {} } }
        : { ok: true, outcome: { status: "zero_results", providerStatus: "ZERO_RESULTS" } };
    },
    travelTime: async (_a, _b, _mode, opts) => {
      calls.push(opts ?? {});
      return { ok: true, outcome: { status: "resolved", durationSeconds: minutes * 60, distanceMeters: 1000, providerStatus: "OK" } };
    }
  } as MapGateway;
}

describe("candidate feasibility", () => {
  let conn: SqliteConnection;
  beforeEach(() => {
    conn = makeTestDb();
  });

  it("assumes the default origin, asks the agent to verify the route, and passes arrival time", async () => {
    const calls: { arrivalTime?: number }[] = [];
    const r = await checkCandidateFeasibility(conn.db, fakeMap(50, calls), {
      start: "2026-10-16T19:00:00+09:00", end: "2026-10-16T21:00:00+09:00", location: "코엑스"
    }, NOW);
    expect(r.verdict).toBe("possible");
    expect(r.legs[0]).toMatchObject({ from: { source: "default_origin", label: "홍익대학교 서울캠퍼스" }, minutes: 50, basis: "google_transit_estimate" });
    expect(r.legs[0]!.naverUrl).toMatch(/^https:\/\/map\.naver\.com\/p\/directions\//);
    expect(calls[0]!.arrivalTime).toBe(Date.parse("2026-10-16T18:50:00+09:00") / 1000);
    expect(r.analysisRequests.map((a) => a.kind).sort()).toEqual(["origin_check", "route_check"]);
  });

  it("starts from the previous in-person event and flags a tight or impossible transfer", async () => {
    conn.db.insert(events).values({
      title: "수업", start: "2026-10-16T16:00:00+09:00", end: "2026-10-16T18:30:00+09:00", location: "신촌역", source: "gcal"
    }).run();
    const tight = await checkCandidateFeasibility(conn.db, fakeMap(15), {
      start: "2026-10-16T19:00:00+09:00", location: "강남역"
    }, NOW);
    expect(tight.legs[0]).toMatchObject({ from: { source: "previous_event", label: "신촌역" }, slackMinutes: 5 });
    expect(tight.verdict).toBe("tight");
    expect(tight.analysisRequests[0]).toMatchObject({ kind: "route_check", priority: "high" });

    const hard = await checkCandidateFeasibility(conn.db, fakeMap(40), { start: "2026-10-16T19:00:00+09:00", location: "강남역" }, NOW);
    expect(hard.verdict).toBe("hard");
  });

  it("uses a pinned route over the provider and drops the route check", async () => {
    const app = buildServer(conn.db, undefined, fakeMap(90));
    const pin = await app.inject({ method: "POST", url: "/api/routes/pin", payload: { from: "홍익대학교 서울캠퍼스", to: "코엑스", minutes: 55, note: "2호선 한 번" } });
    expect(pin.statusCode).toBe(200);
    const r = await checkCandidateFeasibility(conn.db, fakeMap(90), { start: "2026-10-16T19:00:00+09:00", location: "코엑스" }, NOW);
    expect(r.legs[0]).toMatchObject({ minutes: 55, basis: "pinned", note: "2호선 한 번" });
    expect(r.analysisRequests.map((a) => a.kind)).toEqual(["origin_check"]);
  });

  it("treats online events as conflict-only and reports overlaps as hard", async () => {
    conn.db.insert(events).values({ title: "회의", start: "2026-10-16T19:30:00+09:00", end: "2026-10-16T20:30:00+09:00", source: "cairn" }).run();
    const r = await checkCandidateFeasibility(conn.db, fakeMap(10), { start: "2026-10-16T19:00:00+09:00", online: true }, NOW);
    expect(r.verdict).toBe("hard");
    expect(r.legs).toHaveLength(0);
    expect(r.conflicts[0]!.title).toBe("회의");
  });

  it("proposes an event once per URL and creates a remote event on accept", async () => {
    const app = buildServer(conn.db, undefined, fakeMap(30));
    const payload = { title: "Solana Seoul online AMA", start: "2026-10-20T21:00:00+09:00", online: true, url: "https://lu.ma/abc", origin: "luma", proposedBy: "remote:ChatGPT" };
    const first = await app.inject({ method: "POST", url: "/api/inbox/propose-event", payload });
    expect(first.json().data).toMatchObject({ alreadyKnown: false, feasibility: { verdict: "possible" } });
    const again = await app.inject({ method: "POST", url: "/api/inbox/propose-event", payload: { ...payload, title: "다른 제목" } });
    expect(again.json().data).toMatchObject({ alreadyKnown: true, inboxId: first.json().data.inboxId });
    expect(conn.db.select().from(inboxItems).all()).toHaveLength(1);

    await app.inject({ method: "POST", url: `/api/inbox/${first.json().data.inboxId}/answer`, payload: { decision: "accept" } });
    expect(conn.db.select().from(events).all()[0]).toMatchObject({ title: "Solana Seoul online AMA", mode: "remote", location: null });
  });
});
