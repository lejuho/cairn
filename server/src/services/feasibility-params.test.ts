import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { readFeasibilityParamSettings, writeFeasibilityParams } from "./feasibility-params.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-feas-params-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("readFeasibilityParamSettings", () => {
  it("returns defaults when params table is empty", () => {
    const conn = makeTestDb();
    const settings = readFeasibilityParamSettings(conn.db);
    expect(settings.params).toEqual(settings.defaults);
    expect(settings.params.energyBudget).toBe(8);
    expect(settings.params.meetBufferMinutes).toBe(15);
    expect(settings.params.deepBufferMinutes).toBe(30);
    expect(settings.params.travelMargin).toBe(1);
    expect(settings.params.maxContinuousMinutes).toBe(600);
    conn.sqlite.close();
  });

  it("returns limits with correct unit strings", () => {
    const conn = makeTestDb();
    const settings = readFeasibilityParamSettings(conn.db);
    expect(settings.limits.energyBudget.unit).toBe("h");
    expect(settings.limits.meetBufferMinutes.unit).toBe("min");
    expect(settings.limits.travelMargin.unit).toBe("x");
    conn.sqlite.close();
  });

  it("reflects written values", () => {
    const conn = makeTestDb();
    writeFeasibilityParams(conn.db, {
      energyBudget: 6,
      meetBufferMinutes: 20,
      deepBufferMinutes: 45,
      travelMargin: 1.5,
      maxContinuousMinutes: 480
    });
    const settings = readFeasibilityParamSettings(conn.db);
    expect(settings.params.energyBudget).toBe(6);
    expect(settings.params.meetBufferMinutes).toBe(20);
    expect(settings.params.deepBufferMinutes).toBe(45);
    expect(settings.params.travelMargin).toBe(1.5);
    expect(settings.params.maxContinuousMinutes).toBe(480);
    conn.sqlite.close();
  });

  it("falls back to default when DB value is malformed", () => {
    const conn = makeTestDb();
    conn.sqlite.prepare("INSERT INTO params (key, value) VALUES (?, ?)").run("energy_budget", "abc");
    const settings = readFeasibilityParamSettings(conn.db);
    expect(settings.params.energyBudget).toBe(8);
    conn.sqlite.close();
  });
});

describe("writeFeasibilityParams", () => {
  it("persists all five keys atomically", () => {
    const conn = makeTestDb();
    writeFeasibilityParams(conn.db, {
      energyBudget: 10,
      meetBufferMinutes: 10,
      deepBufferMinutes: 20,
      travelMargin: 2,
      maxContinuousMinutes: 300
    });
    const rows = conn.sqlite.prepare("SELECT key, value FROM params ORDER BY key").all() as { key: string; value: string }[];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(map["energy_budget"]).toBe("10");
    expect(map["meet_buffer"]).toBe("10");
    expect(map["deep_buffer"]).toBe("20");
    expect(map["travel_margin"]).toBe("2");
    expect(map["max_continuous"]).toBe("300");
    conn.sqlite.close();
  });

  it("serializes decimal values stably", () => {
    const conn = makeTestDb();
    writeFeasibilityParams(conn.db, {
      energyBudget: 7.5,
      meetBufferMinutes: 15,
      deepBufferMinutes: 30,
      travelMargin: 1.2,
      maxContinuousMinutes: 600
    });
    const row = conn.sqlite.prepare("SELECT value FROM params WHERE key = ?").get("energy_budget") as { value: string };
    expect(row.value).toBe("7.5");
    const travel = conn.sqlite.prepare("SELECT value FROM params WHERE key = ?").get("travel_margin") as { value: string };
    expect(travel.value).toBe("1.2");
    conn.sqlite.close();
  });
});
