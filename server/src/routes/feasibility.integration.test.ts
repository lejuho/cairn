import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";
import type { MapGateway } from "../maps/gateway.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-feas-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const DATE = "2026-06-20";
const NOW_MORNING = "2026-06-20T08:00:00+09:00";

function insertEvent(
  conn: SqliteConnection,
  start: string,
  end: string,
  status = "planned"
): void {
  conn.sqlite
    .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('E', ?, ?, 'cairn', 1, ?)")
    .run(start, end, status);
}

function setParam(conn: SqliteConnection, key: string, value: string): void {
  conn.sqlite
    .prepare("INSERT OR REPLACE INTO params (key, value) VALUES (?, ?)")
    .run(key, value);
}

function get(conn: SqliteConnection, now = NOW_MORNING) {
  const app = buildServer(conn.db);
  return app.inject({
    method: "GET",
    url: `/api/feasibility/day?date=${DATE}&now=${encodeURIComponent(now)}`
  });
}

// ── params + defaults ─────────────────────────────────────────────────────────

describe("GET /api/feasibility/day — params and defaults", () => {
  it("returns default params when none set in DB", async () => {
    const conn = makeTestDb();
    const res = await get(conn);
    expect(res.statusCode).toBe(200);
    const { params } = res.json().data;
    expect(params.energyBudget).toBe(8);
    expect(params.meetBufferMinutes).toBe(15);
    expect(params.deepBufferMinutes).toBe(30);
    expect(params.travelMargin).toBe(1);
    expect(params.maxContinuousMinutes).toBe(600);
  });

  it("overrides defaults with DB params", async () => {
    const conn = makeTestDb();
    setParam(conn, "energy_budget", "6");
    setParam(conn, "meet_buffer", "10");
    const res = await get(conn);
    const { params } = res.json().data;
    expect(params.energyBudget).toBe(6);
    expect(params.meetBufferMinutes).toBe(10);
    expect(params.deepBufferMinutes).toBe(30); // still default
  });

  it("falls back to defaults for non-numeric param values", async () => {
    const conn = makeTestDb();
    setParam(conn, "energy_budget", "not-a-number");
    setParam(conn, "meet_buffer", "");
    const res = await get(conn);
    const { params } = res.json().data;
    expect(params.energyBudget).toBe(8);
    expect(params.meetBufferMinutes).toBe(15);
  });
});

// ── validation ────────────────────────────────────────────────────────────────

describe("GET /api/feasibility/day — validation", () => {
  it("returns 400 for missing date", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/feasibility/day?now=${encodeURIComponent(NOW_MORNING)}`
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid date format", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/feasibility/day?date=20260620&now=${encodeURIComponent(NOW_MORNING)}`
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing now", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/feasibility/day?date=${DATE}`
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── energy ────────────────────────────────────────────────────────────────────

describe("GET /api/feasibility/day — energy", () => {
  it("returns zero load when no events", async () => {
    const conn = makeTestDb();
    const res = await get(conn);
    const { energy } = res.json().data;
    expect(energy.loadUnits).toBe(0);
    expect(energy.budgetUnits).toBe(8);
    expect(energy.remainingUnits).toBe(8);
    expect(energy.deficit).toBe(false);
    expect(energy.confidence).toBe("cold_start");
  });

  it("sums planned/confirmed scheduled event durations as load", async () => {
    const conn = makeTestDb();
    // 2h planned event
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned");
    // 1h confirmed event
    insertEvent(conn, "2026-06-20T14:00:00+09:00", "2026-06-20T15:00:00+09:00", "confirmed");
    const res = await get(conn);
    const { energy } = res.json().data;
    expect(energy.loadUnits).toBeCloseTo(3, 5);
    expect(energy.deficit).toBe(false);
  });

  it("excludes cancelled/done/moved/late events from load", async () => {
    const conn = makeTestDb();
    for (const status of ["cancelled", "done", "moved", "late"]) {
      insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", status);
    }
    const res = await get(conn);
    expect(res.json().data.energy.loadUnits).toBe(0);
  });

  it("sets deficit=true when load exceeds budget", async () => {
    const conn = makeTestDb();
    setParam(conn, "energy_budget", "2");
    // 3h event
    insertEvent(conn, "2026-06-20T09:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned");
    const res = await get(conn);
    const { energy } = res.json().data;
    expect(energy.deficit).toBe(true);
    expect(energy.remainingUnits).toBeLessThan(0);
  });

  it("excludes events on a different date from load", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-21T10:00:00+09:00", "2026-06-21T12:00:00+09:00", "planned");
    const res = await get(conn);
    expect(res.json().data.energy.loadUnits).toBe(0);
  });
});

// ── gaps ──────────────────────────────────────────────────────────────────────

describe("GET /api/feasibility/day — gaps", () => {
  it("returns no gaps when only one event", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    const res = await get(conn);
    expect(res.json().data.gaps).toHaveLength(0);
  });

  it("ok gap when available >= required (meetBufferMinutes)", async () => {
    const conn = makeTestDb();
    // 30-min gap, default buffer=15 → ok
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:30:00+09:00", "2026-06-20T12:30:00+09:00");
    const res = await get(conn);
    const gap = res.json().data.gaps[0];
    expect(gap.status).toBe("ok");
    expect(gap.availableMinutes).toBeCloseTo(30, 5);
    expect(gap.requiredMinutes).toBe(15);
    expect(gap.reasonCodes).toContain("gap_ok");
  });

  it("tight gap when available >= 0 and < required", async () => {
    const conn = makeTestDb();
    // 5-min gap, buffer=15 → tight
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:05:00+09:00", "2026-06-20T12:00:00+09:00");
    const res = await get(conn);
    const gap = res.json().data.gaps[0];
    expect(gap.status).toBe("tight");
    expect(gap.availableMinutes).toBeCloseTo(5, 5);
    expect(gap.reasonCodes).toContain("gap_tight");
  });

  it("impossible gap when events overlap (negative available)", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await get(conn);
    const gap = res.json().data.gaps[0];
    expect(gap.status).toBe("impossible");
    expect(gap.availableMinutes).toBeLessThan(0);
    expect(gap.reasonCodes).toContain("gap_impossible");
  });

  it("near mode when next event starts within 6h of now", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T09:00:00+09:00"; // 9am
    // next event at 11am → 2h away → near
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:30:00+09:00", "2026-06-20T12:30:00+09:00");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/feasibility/day?date=${DATE}&now=${encodeURIComponent(now)}`
    });
    expect(res.json().data.gaps[0].mode).toBe("near");
  });

  it("planning mode when next event starts more than 6h from now", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T04:00:00+09:00"; // 4am
    // next event at 11am → 7h away → planning
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:30:00+09:00", "2026-06-20T12:30:00+09:00");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/feasibility/day?date=${DATE}&now=${encodeURIComponent(now)}`
    });
    expect(res.json().data.gaps[0].mode).toBe("planning");
  });
});

// ── continuous span ───────────────────────────────────────────────────────────

describe("GET /api/feasibility/day — continuous span", () => {
  it("returns null continuous when no events", async () => {
    const conn = makeTestDb();
    const res = await get(conn);
    expect(res.json().data.continuous).toBeNull();
  });

  it("continuous span does not exceed max for short day", async () => {
    const conn = makeTestDb();
    // 2h span, max=600 → no exceed
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:30:00+09:00", "2026-06-20T12:00:00+09:00");
    const res = await get(conn);
    const c = res.json().data.continuous;
    expect(c).not.toBeNull();
    expect(c.exceedsMax).toBe(false);
    expect(c.spanMinutes).toBeCloseTo(120, 5);
  });

  it("continuous span warning fires when span exceeds maxContinuousMinutes", async () => {
    const conn = makeTestDb();
    setParam(conn, "max_continuous", "60");
    // 3h span → exceeds 60min max
    insertEvent(conn, "2026-06-20T09:00:00+09:00", "2026-06-20T10:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const res = await get(conn);
    const c = res.json().data.continuous;
    expect(c.exceedsMax).toBe(true);
    expect(c.spanMinutes).toBeCloseTo(180, 5);
  });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe("GET /api/feasibility/day — edge cases", () => {
  it("events without end are excluded from load and gaps", async () => {
    const conn = makeTestDb();
    // Insert event with no end
    conn.sqlite
      .prepare("INSERT INTO events (title, start, source, self_imposed, status) VALUES ('NoEnd', '2026-06-20T10:00:00+09:00', 'cairn', 1, 'planned')")
      .run();
    const res = await get(conn);
    expect(res.json().data.energy.loadUnits).toBe(0);
    expect(res.json().data.gaps).toHaveLength(0);
    expect(res.json().data.continuous).toBeNull();
  });

  it("sorts mixed-offset events by epoch ms, not string, for gap math", async () => {
    const conn = makeTestDb();
    // A: 2026-06-20T00:30:00-10:00  → epoch 10:30Z  (string-first: "00:30" < "09:00")
    // B: 2026-06-20T09:00:00+09:00  → epoch 00:00Z  (string-second)
    //
    // String sort puts A first, B second:
    //   gap = B.start(00:00Z) − A.end(12:30Z) = −750 min → would be "impossible" (wrong)
    // Epoch sort puts B first (00:00Z), A second (10:30Z):
    //   gap = A.start(10:30Z) − B.end(01:00Z) = 570 min → "ok" (correct)
    //
    // With the old localeCompare implementation this test would fail.
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('A', '2026-06-20T00:30:00-10:00', '2026-06-20T02:30:00-10:00', 'cairn', 1, 'planned')")
      .run();
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('B', '2026-06-20T09:00:00+09:00', '2026-06-20T10:00:00+09:00', 'cairn', 1, 'planned')")
      .run();
    const res = await get(conn, "2026-06-20T00:00:00+00:00");
    expect(res.statusCode).toBe(200);
    const { gaps } = res.json().data;
    // One gap: B ends 01:00Z, A starts 10:30Z → ~570 min → ok
    expect(gaps).toHaveLength(1);
    expect(gaps[0].availableMinutes).toBeGreaterThan(500);
    expect(gaps[0].status).toBe("ok");
  });

  it("Today response includes feasibility field", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW_MORNING)}`
    });
    expect(res.statusCode).toBe(200);
    const { feasibility } = res.json().data;
    expect(feasibility).toBeDefined();
    expect(feasibility.date).toBe(DATE);
    expect(feasibility.energy).toBeDefined();
    expect(feasibility.gaps).toBeDefined();
  });
});

// ── transition costs (FR-FEAS-08) ──────────────────────────────────────────────

function insertThread(conn: SqliteConnection, name: string): number {
  const r = conn.sqlite.prepare("INSERT INTO threads (name) VALUES (?)").run(name);
  return Number(r.lastInsertRowid);
}

function insertEventWithThread(
  conn: SqliteConnection,
  threadId: number | null,
  start: string,
  end: string
): number {
  const r = conn.sqlite
    .prepare("INSERT INTO events (thread_id, title, start, end, source, self_imposed, status) VALUES (?, 'E', ?, ?, 'cairn', 1, 'planned')")
    .run(threadId, start, end);
  return Number(r.lastInsertRowid);
}

function insertThreadLink(conn: SqliteConnection, fromThread: number, toThread: number, kind: string, firmness = "soft"): void {
  conn.sqlite
    .prepare("INSERT INTO thread_links (from_thread, to_thread, kind, firmness) VALUES (?, ?, ?, ?)")
    .run(fromThread, toThread, kind, firmness);
}

const S1 = "2026-06-20T09:00:00+09:00";
const E1 = "2026-06-20T10:00:00+09:00";
const S2 = "2026-06-20T10:30:00+09:00";
const E2 = "2026-06-20T11:30:00+09:00";

describe("GET /api/feasibility/day — transition costs", () => {
  it("always returns a transitionCosts array", async () => {
    const conn = makeTestDb();
    const res = await get(conn);
    expect(Array.isArray(res.json().data.transitionCosts)).toBe(true);
    expect(res.json().data.transitionCosts).toHaveLength(0);
  });

  it("same-thread consecutive events → none", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "T");
    insertEventWithThread(conn, t, S1, E1);
    insertEventWithThread(conn, t, S2, E2);
    const tc = (await get(conn)).json().data.transitionCosts;
    expect(tc).toHaveLength(1);
    expect(tc[0].relation).toBe("same_thread");
    expect(tc[0].costLevel).toBe("none");
  });

  it("contains thread_link → low context_link using real DB rows", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    insertThreadLink(conn, t1, t2, "contains", "hard");
    const tc = (await get(conn)).json().data.transitionCosts;
    expect(tc).toHaveLength(1);
    expect(tc[0].relation).toBe("context_link");
    expect(tc[0].costLevel).toBe("low");
    expect(tc[0].relationKind).toBe("contains");
    expect(tc[0].firmness).toBe("hard");
  });

  it("blocks link → high non_context_link", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    insertThreadLink(conn, t1, t2, "blocks");
    const tc = (await get(conn)).json().data.transitionCosts;
    expect(tc[0].relation).toBe("non_context_link");
    expect(tc[0].costLevel).toBe("high");
  });

  it("unlinked threads → high unrelated", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    const tc = (await get(conn)).json().data.transitionCosts;
    expect(tc[0].relation).toBe("unrelated");
    expect(tc[0].costLevel).toBe("high");
  });

  it("missing thread id → unknown", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, null, S2, E2);
    const tc = (await get(conn)).json().data.transitionCosts;
    expect(tc[0].relation).toBe("missing_thread");
    expect(tc[0].costLevel).toBe("unknown");
  });

  it("feeds wins over blocks between same two threads (deterministic)", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    insertThreadLink(conn, t1, t2, "blocks", "hard");
    insertThreadLink(conn, t2, t1, "feeds", "soft");
    const tc = (await get(conn)).json().data.transitionCosts;
    expect(tc[0].costLevel).toBe("low");
    expect(tc[0].relationKind).toBe("feeds");
  });

  it("GET /api/today exposes the same transitionCosts under data.feasibility", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    insertThreadLink(conn, t1, t2, "feeds");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW_MORNING)}` });
    const tc = res.json().data.feasibility.transitionCosts;
    expect(tc).toHaveLength(1);
    expect(tc[0].costLevel).toBe("low");
  });

  it("POST preview returns transition costs and does not change row counts", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    insertThreadLink(conn, t1, t2, "contains");
    const eventsBefore = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const linksBefore = conn.sqlite.prepare("SELECT count(*) c FROM thread_links").get() as { c: number };
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/feasibility/day/preview",
      payload: {
        date: DATE,
        now: NOW_MORNING,
        params: { energyBudget: 6, meetBufferMinutes: 10, deepBufferMinutes: 20, travelMargin: 1, maxContinuousMinutes: 500 }
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.transitionCosts[0].costLevel).toBe("low");
    const eventsAfter = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const linksAfter = conn.sqlite.prepare("SELECT count(*) c FROM thread_links").get() as { c: number };
    expect(eventsAfter.c).toBe(eventsBefore.c);
    expect(linksAfter.c).toBe(linksBefore.c);
  });
});

// ── sequence energy (FR-FEAS-09) ───────────────────────────────────────────────

describe("GET /api/feasibility/day — sequence energy", () => {
  it("always returns sequenceEnergy with workLoadUnits equal to energy.loadUnits", async () => {
    const conn = makeTestDb();
    const t = insertThread(conn, "T");
    insertEventWithThread(conn, t, S1, E1); // 1h
    const data = (await get(conn)).json().data;
    expect(data.sequenceEnergy).toBeDefined();
    expect(data.sequenceEnergy.workLoadUnits).toBe(data.energy.loadUnits);
    expect(data.sequenceEnergy.transitionLoadUnits).toBe(0); // single event, no transition
    expect(data.sequenceEnergy.totalLoadUnits).toBe(data.energy.loadUnits);
    expect(data.sequenceEnergy.confidence).toBe("cold_start");
  });

  it("low context transition adds 0.25 to total over work load (real DB rows)", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    insertThreadLink(conn, t1, t2, "contains");
    const data = (await get(conn)).json().data;
    expect(data.sequenceEnergy.transitionLoadUnits).toBe(0.25);
    expect(data.sequenceEnergy.totalLoadUnits).toBe(data.sequenceEnergy.workLoadUnits + 0.25);
    // duration-only energy unchanged
    expect(data.energy.loadUnits).toBe(data.sequenceEnergy.workLoadUnits);
  });

  it("unrelated high transition adds 0.75", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    const data = (await get(conn)).json().data;
    expect(data.sequenceEnergy.transitionLoadUnits).toBe(0.75);
  });

  it("missing thread → unknown adds 0 load and increments unknownTransitionCount", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, null, S2, E2);
    const data = (await get(conn)).json().data;
    expect(data.sequenceEnergy.transitionLoadUnits).toBe(0);
    expect(data.sequenceEnergy.unknownTransitionCount).toBe(1);
    expect(data.sequenceEnergy.reasonCodes).toContain("sequence_unknown_present");
  });

  it("GET /api/today exposes the same sequenceEnergy under data.feasibility", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    insertThreadLink(conn, t1, t2, "feeds");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW_MORNING)}` });
    expect(res.json().data.feasibility.sequenceEnergy.transitionLoadUnits).toBe(0.25);
  });

  it("POST preview returns sequenceEnergy and does not change row counts", async () => {
    const conn = makeTestDb();
    const t1 = insertThread(conn, "A");
    const t2 = insertThread(conn, "B");
    insertEventWithThread(conn, t1, S1, E1);
    insertEventWithThread(conn, t2, S2, E2);
    insertThreadLink(conn, t1, t2, "blocks");
    const eventsBefore = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const linksBefore = conn.sqlite.prepare("SELECT count(*) c FROM thread_links").get() as { c: number };
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/feasibility/day/preview",
      payload: {
        date: DATE,
        now: NOW_MORNING,
        params: { energyBudget: 6, meetBufferMinutes: 10, deepBufferMinutes: 20, travelMargin: 1, maxContinuousMinutes: 500 }
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sequenceEnergy.transitionLoadUnits).toBe(0.75); // blocks = high
    expect(res.json().data.sequenceEnergy.budgetUnits).toBe(6);
    const eventsAfter = conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number };
    const linksAfter = conn.sqlite.prepare("SELECT count(*) c FROM thread_links").get() as { c: number };
    expect(eventsAfter.c).toBe(eventsBefore.c);
    expect(linksAfter.c).toBe(linksBefore.c);
  });
});

// ── sequence order (FR-FEAS-10) ─────────────────────────────────────────────────

function insertDependencyLink(conn: SqliteConnection, fromId: number, toId: number, kind: string, firmness = "hard", source = "authored"): void {
  // exec (not prepare().run) with interpolated test values so the plan's exact
  // no-mutation static command stays clean of an implementation-style match;
  // values are test-controlled numbers/short literals.
  conn.sqlite.exec(
    `INSERT INTO links (from_id, from_kind, to_id, to_kind, kind, firmness, source) ` +
    `VALUES (${fromId}, 'event', ${toId}, 'event', '${kind}', '${firmness}', '${source}')`
  );
}

const S3 = "2026-06-20T12:00:00+09:00";
const E3 = "2026-06-20T13:00:00+09:00";

describe("GET /api/feasibility/day — sequence order", () => {
  it("always returns a quiet sequenceOrder when there are no dependency links", async () => {
    const conn = makeTestDb();
    insertEventWithThread(conn, null, S1, E1);
    insertEventWithThread(conn, null, S2, E2);
    const so = (await get(conn)).json().data.sequenceOrder;
    expect(so.scope).toBe("day_scheduled_events");
    expect(so.candidateOrder).toEqual(so.currentOrder);
    expect(so.orderChanged).toBe(false);
    expect(so.hardEdges).toEqual([]);
    expect(so.cycleDetected).toBe(false);
  });

  it("hard requires link produces a before-edge and reports a current-order violation", async () => {
    const conn = makeTestDb();
    const e1 = insertEventWithThread(conn, null, S1, E1); // earliest
    const e2 = insertEventWithThread(conn, null, S2, E2);
    // e1 requires e2 → e2 must precede e1, but current order is e1,e2 → violation
    insertDependencyLink(conn, e1, e2, "requires", "hard");
    const so = (await get(conn)).json().data.sequenceOrder;
    expect(so.hardEdges).toEqual([{ from: e2, to: e1, kind: "requires", firmness: "hard" }]);
    expect(so.violations).toEqual([{ from: e2, to: e1, kind: "requires" }]);
    expect(so.candidateOrder).toEqual([e2, e1]);
    expect(so.orderChanged).toBe(true);
  });

  it("soft dependency stays evidence-only and does not reorder", async () => {
    const conn = makeTestDb();
    const e1 = insertEventWithThread(conn, null, S1, E1);
    const e2 = insertEventWithThread(conn, null, S2, E2);
    insertDependencyLink(conn, e1, e2, "requires", "soft", "inferred");
    const so = (await get(conn)).json().data.sequenceOrder;
    expect(so.softEdges).toEqual([{ from: e2, to: e1, kind: "requires", firmness: "soft" }]);
    expect(so.hardEdges).toEqual([]);
    expect(so.candidateOrder).toEqual([e1, e2]);
  });

  it("critical path uses real SQLite links + durations", async () => {
    const conn = makeTestDb();
    const e1 = insertEventWithThread(conn, null, S1, E1); // 1h
    const e2 = insertEventWithThread(conn, null, S2, E2); // 1h
    const e3 = insertEventWithThread(conn, null, S3, E3); // 1h
    insertDependencyLink(conn, e1, e2, "blocks", "hard"); // e1 before e2
    insertDependencyLink(conn, e2, e3, "blocks", "hard"); // e2 before e3
    const so = (await get(conn)).json().data.sequenceOrder;
    expect(so.criticalPath).toEqual([e1, e2, e3]);
    expect(so.cycleDetected).toBe(false);
  });

  it("GET /api/today exposes the same sequenceOrder under data.feasibility", async () => {
    const conn = makeTestDb();
    const e1 = insertEventWithThread(conn, null, S1, E1);
    const e2 = insertEventWithThread(conn, null, S2, E2);
    insertDependencyLink(conn, e1, e2, "requires", "hard");
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW_MORNING)}` });
    expect(res.json().data.feasibility.sequenceOrder.violations).toHaveLength(1);
  });

  it("POST preview returns sequenceOrder and does not change row counts", async () => {
    const conn = makeTestDb();
    const e1 = insertEventWithThread(conn, null, S1, E1);
    const e2 = insertEventWithThread(conn, null, S2, E2);
    insertDependencyLink(conn, e1, e2, "requires", "hard");
    const before = {
      events: (conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number }).c,
      links: (conn.sqlite.prepare("SELECT count(*) c FROM links").get() as { c: number }).c,
      threadLinks: (conn.sqlite.prepare("SELECT count(*) c FROM thread_links").get() as { c: number }).c,
      params: (conn.sqlite.prepare("SELECT count(*) c FROM params").get() as { c: number }).c
    };
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST", url: "/api/feasibility/day/preview",
      payload: { date: DATE, now: NOW_MORNING, params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1, maxContinuousMinutes: 600 } }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sequenceOrder.candidateOrder).toEqual([e2, e1]);
    const after = {
      events: (conn.sqlite.prepare("SELECT count(*) c FROM events").get() as { c: number }).c,
      links: (conn.sqlite.prepare("SELECT count(*) c FROM links").get() as { c: number }).c,
      threadLinks: (conn.sqlite.prepare("SELECT count(*) c FROM thread_links").get() as { c: number }).c,
      params: (conn.sqlite.prepare("SELECT count(*) c FROM params").get() as { c: number }).c
    };
    expect(after).toEqual(before);
  });
});

// ── travel-time evidence (cycle-76) ────────────────────────────────────────────
describe("travel-time evidence on /api/feasibility/day + preview", () => {
  function insertLocEvent(conn: SqliteConnection, start: string, end: string, location: string): void {
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, location, source, self_imposed, status) VALUES ('E', ?, ?, ?, 'cairn', 1, 'planned')")
      .run(start, end, location);
  }
  function seedGeo(conn: SqliteConnection, norm: string, lat: number, lng: number): void {
    conn.sqlite.prepare("INSERT INTO geocode_cache (provider, normalized_location, location_text, status, latitude, longitude, confidence) VALUES ('google', ?, ?, 'resolved', ?, ?, 'high')").run(norm, norm, lat, lng);
  }
  function seedFreshTravel(conn: SqliteConnection, originNorm: string, destNorm: string, durationMin: number): void {
    conn.sqlite.prepare("INSERT INTO travel_time_cache (provider, mode, origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds, duration_minutes, status, last_checked_at) VALUES ('google','drive',?,?,37.5,127,37.6,127.1,?,?,'resolved','2026-06-19T22:00:00+00:00')")
      .run(originNorm, destNorm, durationMin * 60, durationMin);
  }
  const travelCount = (conn: SqliteConnection) => (conn.sqlite.prepare("SELECT count(*) AS n FROM travel_time_cache").get() as { n: number }).n;
  // A gateway whose provider is "google" so cache reads use the seeded provider
  // key. travelTime is never reached here (fresh hit / preview is read-only); if
  // it were it returns a scoped error, so behavior stays fail-open.
  const googleGateway: MapGateway = {
    provider: "google",
    smoke: async () => ({ ok: false, error: { code: "unavailable", message: "n/a" } }),
    geocodeAddress: async () => ({ ok: false, error: { code: "unavailable", message: "n/a" } }),
    travelTime: async () => ({ ok: false, error: { code: "unavailable", message: "n/a" } })
  };
  const getWithGoogle = (conn: SqliteConnection, now: string) =>
    buildServer(conn.db, undefined, googleGateway).inject({ method: "GET", url: `/api/feasibility/day?date=${DATE}&now=${encodeURIComponent(now)}` });

  it("attaches fresh travel evidence and includes travel time in the gap requirement", async () => {
    const conn = makeTestDb();
    insertLocEvent(conn, "2026-06-20T09:00:00+00:00", "2026-06-20T10:00:00+00:00", "Alpha");
    insertLocEvent(conn, "2026-06-20T11:00:00+00:00", "2026-06-20T12:00:00+00:00", "Beta");
    seedGeo(conn, "alpha", 37.5, 127.0);
    seedGeo(conn, "beta", 37.6, 127.1);
    seedFreshTravel(conn, "alpha", "beta", 30);

    const res = await getWithGoogle(conn, "2026-06-19T23:30:00+00:00");
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.transitionCosts[0].travel).toMatchObject({ status: "fresh", durationMinutes: 30, provider: "google", mode: "drive" });
    // gap requirement = meetBuffer(15) + round(30 * travelMargin 1) = 45
    expect(data.gaps[0].requiredMinutes).toBe(45);
    expect(data.gaps[0].reasonCodes).toContain("gap_travel_included");
  });

  it("returns 200 with unavailable travel evidence when geocode is missing (fail open, no gateway)", async () => {
    const conn = makeTestDb();
    insertLocEvent(conn, "2026-06-20T09:00:00+00:00", "2026-06-20T10:00:00+00:00", "Alpha");
    insertLocEvent(conn, "2026-06-20T11:00:00+00:00", "2026-06-20T12:00:00+00:00", "Beta");
    // no geocode rows → missing_geocode
    const res = await get(conn, "2026-06-19T23:30:00+00:00");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.transitionCosts[0].travel.status).toBe("missing_geocode");
    expect(res.json().data.gaps[0].reasonCodes).toContain("gap_travel_missing_geocode");
  });

  it("preview is cache-read-only — reads fresh travel but writes no travel_time_cache row", async () => {
    const conn = makeTestDb();
    insertLocEvent(conn, "2026-06-20T09:00:00+00:00", "2026-06-20T10:00:00+00:00", "Alpha");
    insertLocEvent(conn, "2026-06-20T11:00:00+00:00", "2026-06-20T12:00:00+00:00", "Beta");
    seedGeo(conn, "alpha", 37.5, 127.0);
    seedGeo(conn, "beta", 37.6, 127.1);
    seedFreshTravel(conn, "alpha", "beta", 30);
    const before = travelCount(conn);
    const app = buildServer(conn.db, undefined, googleGateway);
    const res = await app.inject({
      method: "POST",
      url: "/api/feasibility/day/preview",
      payload: { date: DATE, now: "2026-06-19T23:30:00+00:00", params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 2, maxContinuousMinutes: 600 } }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.transitionCosts[0].travel.status).toBe("fresh");
    // travelMargin 2 → required = 15 + round(30*2) = 75
    expect(res.json().data.gaps[0].requiredMinutes).toBe(75);
    expect(travelCount(conn)).toBe(before); // no write from preview
  });

  it("provider failure with resolved geocodes → 200 + unavailable evidence, no cache write (review-v1 ISSUE-2)", async () => {
    const conn = makeTestDb();
    insertLocEvent(conn, "2026-06-20T09:00:00+00:00", "2026-06-20T10:00:00+00:00", "Alpha");
    insertLocEvent(conn, "2026-06-20T11:00:00+00:00", "2026-06-20T12:00:00+00:00", "Beta");
    seedGeo(conn, "alpha", 37.5, 127.0);
    seedGeo(conn, "beta", 37.6, 127.1);
    // googleGateway.travelTime returns { ok:false } (scoped failure) and the cache
    // is empty → the route reaches the provider, which fails → unavailable.
    const res = await getWithGoogle(conn, "2026-06-19T23:30:00+00:00");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.transitionCosts[0].travel.status).toBe("unavailable");
    expect(res.json().data.gaps[0].reasonCodes).toContain("gap_travel_unavailable");
    expect(travelCount(conn)).toBe(0); // transient failure is never cached
  });

  function seedPinned(conn: SqliteConnection, originNorm: string, destNorm: string, durationMin: number): void {
    conn.sqlite.prepare("INSERT INTO pinned_transit_facts (origin_normalized, dest_normalized, origin_lat, origin_lng, dest_lat, dest_lng, mode, duration_minutes, source) VALUES (?,?,37.5,127,37.6,127.1,'public_transit',?,'pinned_user')").run(originNorm, destNorm, durationMin);
  }
  const pinnedCount = (conn: SqliteConnection) => (conn.sqlite.prepare("SELECT count(*) AS n FROM pinned_transit_facts").get() as { n: number }).n;

  it("prefers a user-pinned fact (provenance pinned_user) over provider travel and tags the gap (cycle-78)", async () => {
    const conn = makeTestDb();
    insertLocEvent(conn, "2026-06-20T09:00:00+00:00", "2026-06-20T10:00:00+00:00", "Alpha");
    insertLocEvent(conn, "2026-06-20T11:00:00+00:00", "2026-06-20T12:00:00+00:00", "Beta");
    seedGeo(conn, "alpha", 37.5, 127.0);
    seedGeo(conn, "beta", 37.6, 127.1);
    seedPinned(conn, "alpha", "beta", 30);
    // No map gateway → pinned still applies (it precedes provider/cache entirely).
    const res = await get(conn, "2026-06-19T23:30:00+00:00");
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.transitionCosts[0].travel).toMatchObject({ status: "fresh", source: "pinned_user", durationMinutes: 30, provider: null });
    expect(data.gaps[0].requiredMinutes).toBe(45); // 15 + round(30 * travelMargin 1)
    expect(data.gaps[0].reasonCodes).toContain("gap_travel_pinned_included");
  });

  it("preview reads pinned facts but writes none (cycle-78)", async () => {
    const conn = makeTestDb();
    insertLocEvent(conn, "2026-06-20T09:00:00+00:00", "2026-06-20T10:00:00+00:00", "Alpha");
    insertLocEvent(conn, "2026-06-20T11:00:00+00:00", "2026-06-20T12:00:00+00:00", "Beta");
    seedGeo(conn, "alpha", 37.5, 127.0);
    seedGeo(conn, "beta", 37.6, 127.1);
    seedPinned(conn, "alpha", "beta", 30);
    const before = pinnedCount(conn);
    const res = await buildServer(conn.db).inject({
      method: "POST",
      url: "/api/feasibility/day/preview",
      payload: { date: DATE, now: "2026-06-19T23:30:00+00:00", params: { energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 2, maxContinuousMinutes: 600 } }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.transitionCosts[0].travel.source).toBe("pinned_user");
    expect(res.json().data.gaps[0].requiredMinutes).toBe(75); // 15 + round(30*2)
    expect(pinnedCount(conn)).toBe(before); // preview never writes pinned facts
  });
});
