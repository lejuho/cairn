import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

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
    // A at 11:00 UTC+00 = 11:00Z, B at 09:30 UTC+09 = 00:30Z.
    // String order: A ("...11:00:00+00:00") > B ("...09:30:00+09:00") → A would come last.
    // Epoch order: B starts at 00:30Z, A starts at 11:00Z → B comes first chronologically.
    // Insert A (string-first), then B (string-second) to expose the bug when string sort is used.
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('A', '2026-06-20T11:00:00+00:00', '2026-06-20T12:00:00+00:00', 'cairn', 1, 'planned')")
      .run();
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('B', '2026-06-20T09:30:00+09:00', '2026-06-20T10:30:00+09:00', 'cairn', 1, 'planned')")
      .run();
    // B ends at 01:30Z, A starts at 11:00Z → gap = 9.5h → ok
    const res = await get(conn, "2026-06-20T00:00:00+00:00");
    expect(res.statusCode).toBe(200);
    const { gaps } = res.json().data;
    // Exactly one gap between B (ends 01:30Z) and A (starts 11:00Z): ~570 min available → ok
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
