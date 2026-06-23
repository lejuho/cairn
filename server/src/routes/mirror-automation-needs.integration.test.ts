import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-mirror-auto-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("GET /api/mirror/automation-needs", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  const OBSERVED_AT = "2026-06-22T09:00:00.000Z";

  it("returns empty items when no manual-exogenous watchers", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/automation-needs" });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.items).toHaveLength(0);
    expect(data.sampleStatus).toBe("ok");
  });

  it("returns 400 for from > to", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/automation-needs?from=2026-06-30&to=2026-06-01" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for range > 90 days", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: "/api/mirror/automation-needs?from=2026-01-01&to=2026-06-30" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("cold-start watcher (<3 logs) → quiet + low_sample", async () => {
    const app = buildServer(conn.db);
    const createRes = await app.inject({
      method: "POST", url: "/api/watchers/manual-exogenous",
      payload: { label: "Cold watcher", sourceStability: "unknown" }
    });
    const watcherId = createRes.json().data.watcher.id as number;

    await app.inject({ method: "POST", url: `/api/watchers/${watcherId}/manual-log`, payload: { outcome: "signal_seen", observedAt: OBSERVED_AT } });

    const res = await app.inject({ method: "GET", url: "/api/mirror/automation-needs?from=2026-06-01&to=2026-06-30" });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.items[0]?.level).toBe("quiet");
    expect(data.items[0]?.reasonCodes).toContain("low_sample");
    expect(data.sampleStatus).toBe("low_sample");
  });

  it("enough misses → shows in items", async () => {
    const app = buildServer(conn.db);
    const createRes = await app.inject({
      method: "POST", url: "/api/watchers/manual-exogenous",
      payload: { label: "Missed watcher", sourceStability: "unknown" }
    });
    const watcherId = createRes.json().data.watcher.id as number;

    for (const outcome of ["signal_seen", "signal_seen", "signal_seen", "missed_signal", "missed_signal", "missed_signal"]) {
      await app.inject({
        method: "POST", url: `/api/watchers/${watcherId}/manual-log`,
        payload: { outcome, observedAt: OBSERVED_AT }
      });
    }

    const res = await app.inject({ method: "GET", url: "/api/mirror/automation-needs?from=2026-06-01&to=2026-06-30" });
    expect(res.statusCode).toBe(200);
    const item = res.json().data.items[0];
    expect(item?.level).toBe("watch");
    expect(item?.missedSignalCount).toBe(3);
  });

  it("items with consider_lightweight appear above watch in sort", async () => {
    const app = buildServer(conn.db);

    const w1Res = await app.inject({
      method: "POST", url: "/api/watchers/manual-exogenous",
      payload: { label: "Watch watcher", sourceStability: "unknown" }
    });
    const w1Id = w1Res.json().data.watcher.id as number;
    for (const o of ["signal_seen", "signal_seen", "signal_seen", "missed_signal"]) {
      await app.inject({ method: "POST", url: `/api/watchers/${w1Id}/manual-log`, payload: { outcome: o, observedAt: OBSERVED_AT } });
    }

    const w2Res = await app.inject({
      method: "POST", url: "/api/watchers/manual-exogenous",
      payload: { label: "Consider watcher", sourceStability: "stable" }
    });
    const w2Id = w2Res.json().data.watcher.id as number;
    for (const o of ["signal_seen", "signal_seen", "signal_seen", "missed_signal", "missed_signal", "missed_signal"]) {
      await app.inject({ method: "POST", url: `/api/watchers/${w2Id}/manual-log`, payload: { outcome: o, observedAt: OBSERVED_AT } });
    }

    const res = await app.inject({ method: "GET", url: "/api/mirror/automation-needs?from=2026-06-01&to=2026-06-30" });
    const items = res.json().data.items as { level: string; label: string }[];
    // consider_lightweight before watch
    const considerIdx = items.findIndex((i) => i.level === "consider_lightweight");
    const watchIdx = items.findIndex((i) => i.level === "watch");
    expect(considerIdx).toBeLessThan(watchIdx);
  });
});
