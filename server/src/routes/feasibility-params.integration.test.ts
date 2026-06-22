import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const DATE = "2026-06-22";
const NOW = "2026-06-22T09:00:00+00:00";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-feas-params-int-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("GET /api/feasibility/params", () => {
  it("returns defaults with empty DB", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/feasibility/params" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.params).toEqual(data.defaults);
    expect(data.params.energyBudget).toBe(8);
    expect(data.limits.energyBudget).toMatchObject({ min: 1, max: 16, step: 0.5, unit: "h" });
    conn.sqlite.close();
  });

  it("returns persisted values after PUT", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        energyBudget: 6, meetBufferMinutes: 20, deepBufferMinutes: 45,
        travelMargin: 1.5, maxContinuousMinutes: 480
      })
    });
    const res = await app.inject({ method: "GET", url: "/api/feasibility/params" });
    expect(res.json().data.params.energyBudget).toBe(6);
    conn.sqlite.close();
  });
});

describe("PUT /api/feasibility/params", () => {
  it("returns 200 with updated settings", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        energyBudget: 10, meetBufferMinutes: 10, deepBufferMinutes: 20,
        travelMargin: 2, maxContinuousMinutes: 300
      })
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.params.energyBudget).toBe(10);
    conn.sqlite.close();
  });

  it("returns 400 for missing key", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ energyBudget: 8, meetBufferMinutes: 15, deepBufferMinutes: 30, travelMargin: 1 })
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("returns 400 for out-of-range energyBudget", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        energyBudget: 0, meetBufferMinutes: 15, deepBufferMinutes: 30,
        travelMargin: 1, maxContinuousMinutes: 600
      })
    });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("does not partially write on invalid input", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    // First set a known good value
    await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        energyBudget: 12, meetBufferMinutes: 15, deepBufferMinutes: 30,
        travelMargin: 1, maxContinuousMinutes: 600
      })
    });
    // Now send invalid (out-of-range energyBudget)
    await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        energyBudget: 999, meetBufferMinutes: 15, deepBufferMinutes: 30,
        travelMargin: 1, maxContinuousMinutes: 600
      })
    });
    const res = await app.inject({ method: "GET", url: "/api/feasibility/params" });
    // energyBudget must still be 12, not 999
    expect(res.json().data.params.energyBudget).toBe(12);
    conn.sqlite.close();
  });
});

describe("POST /api/feasibility/day/preview", () => {
  it("returns DayFeasibility using supplied params", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/feasibility/day/preview",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: DATE,
        now: NOW,
        params: {
          energyBudget: 16, meetBufferMinutes: 0, deepBufferMinutes: 0,
          travelMargin: 0.5, maxContinuousMinutes: 960
        }
      })
    });
    expect(res.statusCode).toBe(200);
    const feas = res.json().data;
    expect(feas.params.energyBudget).toBe(16);
    expect(feas.energy).toBeDefined();
    conn.sqlite.close();
  });

  it("does not write to params table", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    await app.inject({
      method: "POST",
      url: "/api/feasibility/day/preview",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: DATE,
        now: NOW,
        params: {
          energyBudget: 16, meetBufferMinutes: 0, deepBufferMinutes: 0,
          travelMargin: 0.5, maxContinuousMinutes: 960
        }
      })
    });
    const paramsRows = conn.sqlite.prepare("SELECT COUNT(*) as count FROM params").get() as { count: number };
    expect(paramsRows.count).toBe(0);
    conn.sqlite.close();
  });

  it("preview params differ from persisted params", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    // Set persisted energyBudget = 4
    await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        energyBudget: 4, meetBufferMinutes: 15, deepBufferMinutes: 30,
        travelMargin: 1, maxContinuousMinutes: 600
      })
    });
    // Preview with energyBudget = 14
    const previewRes = await app.inject({
      method: "POST",
      url: "/api/feasibility/day/preview",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: DATE,
        now: NOW,
        params: {
          energyBudget: 14, meetBufferMinutes: 15, deepBufferMinutes: 30,
          travelMargin: 1, maxContinuousMinutes: 600
        }
      })
    });
    expect(previewRes.json().data.params.energyBudget).toBe(14);
    // Persisted value unchanged
    const getRes = await app.inject({ method: "GET", url: "/api/feasibility/params" });
    expect(getRes.json().data.params.energyBudget).toBe(4);
    conn.sqlite.close();
  });

  it("returns 400 for invalid preview body", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/feasibility/day/preview",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "bad-date", now: NOW, params: {} })
    });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });
});

describe("GET /api/feasibility/day reflects saved params", () => {
  it("uses persisted energyBudget after PUT", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        energyBudget: 2, meetBufferMinutes: 15, deepBufferMinutes: 30,
        travelMargin: 1, maxContinuousMinutes: 600
      })
    });
    const enc = encodeURIComponent(NOW);
    const res = await app.inject({ method: "GET", url: `/api/feasibility/day?date=${DATE}&now=${enc}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.params.energyBudget).toBe(2);
    conn.sqlite.close();
  });
});

describe("GET /api/today reflects saved params", () => {
  it("feasibility.energy.budgetUnits reflects persisted energyBudget", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    await app.inject({
      method: "PUT",
      url: "/api/feasibility/params",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        energyBudget: 16, meetBufferMinutes: 15, deepBufferMinutes: 30,
        travelMargin: 1, maxContinuousMinutes: 600
      })
    });
    const enc = encodeURIComponent(NOW);
    const res = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${enc}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.feasibility.energy.budgetUnits).toBe(16);
    conn.sqlite.close();
  });
});
