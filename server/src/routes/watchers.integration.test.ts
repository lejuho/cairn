import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";

const DATE = "2026-06-22";
const NOW = "2026-06-22T09:00:00+09:00";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-watcher-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("GET /api/watchers", () => {
  let conn: SqliteConnection;

  beforeEach(() => { conn = makeTestDb(); });

  it("returns empty list when no watchers", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.watchers).toHaveLength(0);
  });

  it("returns 400 when date missing", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: `/api/watchers?now=${encodeURIComponent(NOW)}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it("lists all watchers including disarmed", async () => {
    const app = buildServer(conn.db);
    // create one armed watcher
    await app.inject({
      method: "POST", url: "/api/watchers",
      payload: { label: "여권", threshold: "2026-06-20" }
    });
    // disarm it
    const listRes = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const id = listRes.json().data.watchers[0].id;
    await app.inject({ method: "PATCH", url: `/api/watchers/${id}/armed`, payload: { armed: false } });

    const res = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(res.json().data.watchers).toHaveLength(1);
    expect(res.json().data.watchers[0].status).toBe("disarmed");
  });

  it("due watcher has status=due and daysOverdue", async () => {
    const app = buildServer(conn.db);
    await app.inject({
      method: "POST", url: "/api/watchers",
      payload: { label: "여권", threshold: "2026-06-20" } // 2 days ago
    });
    const res = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const w = res.json().data.watchers[0];
    expect(w.status).toBe("due");
    expect(w.daysOverdue).toBe(2);
  });

  it("snoozed watcher shows status=snoozed but absent from Today bubbles", async () => {
    const app = buildServer(conn.db);
    await app.inject({
      method: "POST", url: "/api/watchers",
      payload: { label: "확인", threshold: "2026-06-20" }
    });
    const listRes = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const id = listRes.json().data.watchers[0].id;

    // Snooze until tomorrow
    await app.inject({
      method: "PATCH", url: `/api/watchers/${id}/snooze`,
      payload: { snoozedUntil: "2026-06-23T00:00:00+09:00" }
    });

    const watchRes = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(watchRes.json().data.watchers[0].status).toBe("snoozed");

    // Today should not show it
    const todayRes = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(todayRes.json().data.watcherBubbles).toHaveLength(0);
  });

  it("disarmed row absent from Today watcher bubbles", async () => {
    const app = buildServer(conn.db);
    await app.inject({
      method: "POST", url: "/api/watchers",
      payload: { label: "여권", threshold: "2026-06-20" }
    });
    const listRes = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const id = listRes.json().data.watchers[0].id;
    await app.inject({ method: "PATCH", url: `/api/watchers/${id}/armed`, payload: { armed: false } });

    const todayRes = await app.inject({ method: "GET", url: `/api/today?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(todayRes.json().data.watcherBubbles).toHaveLength(0);
  });
});

describe("PATCH /api/watchers/:id/armed", () => {
  let conn: SqliteConnection;

  beforeEach(() => { conn = makeTestDb(); });

  it("toggles armed to false and persists", async () => {
    const app = buildServer(conn.db);
    await app.inject({ method: "POST", url: "/api/watchers", payload: { label: "X", threshold: "2026-06-20" } });
    const listRes = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const id = listRes.json().data.watchers[0].id;

    const res = await app.inject({ method: "PATCH", url: `/api/watchers/${id}/armed`, payload: { armed: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.armed).toBe(0); // WatcherRow armed is integer

    // Verify persistence via GET
    const list2 = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(list2.json().data.watchers[0].armed).toBe(false);
  });

  it("returns 404 for unknown id", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: "/api/watchers/99999/armed", payload: { armed: true } });
    expect(res.statusCode).toBe(404);
    expect(res.json().ok).toBe(false);
  });

  it("returns 400 for non-boolean armed value", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "PATCH", url: "/api/watchers/1/armed", payload: { armed: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it("re-arms a disarmed watcher", async () => {
    const app = buildServer(conn.db);
    await app.inject({ method: "POST", url: "/api/watchers", payload: { label: "Y", threshold: "2026-06-20" } });
    const listRes = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const id = listRes.json().data.watchers[0].id;

    await app.inject({ method: "PATCH", url: `/api/watchers/${id}/armed`, payload: { armed: false } });
    await app.inject({ method: "PATCH", url: `/api/watchers/${id}/armed`, payload: { armed: true } });

    const finalList = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    expect(finalList.json().data.watchers[0].armed).toBe(true);
    expect(finalList.json().data.watchers[0].status).toBe("due");
  });
});

describe("POST /api/watchers/manual-exogenous", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("creates a kind=B watcher and returns watcher + manualExogenous", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/watchers/manual-exogenous",
      payload: { label: "비자 공고", sourceStability: "stable", sourceLabel: "대사관 사이트" }
    });
    expect(res.statusCode).toBe(201);
    const { watcher, manualExogenous } = res.json().data;
    expect(watcher.kind).toBe("B");
    expect(watcher.label).toBe("비자 공고");
    expect(manualExogenous.type).toBe("manual_exogenous");
    expect(manualExogenous.sourceStability).toBe("stable");
  });

  it("returns 400 for invalid sourceStability", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/watchers/manual-exogenous",
      payload: { label: "X", sourceStability: "fast" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid sourceUrl", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/watchers/manual-exogenous",
      payload: { label: "X", sourceUrl: "not-a-url" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("kind=B watcher appears in GET /api/watchers with manualExogenous field", async () => {
    const app = buildServer(conn.db);
    await app.inject({
      method: "POST",
      url: "/api/watchers/manual-exogenous",
      payload: { label: "비자", sourceStability: "volatile" }
    });
    const res = await app.inject({ method: "GET", url: `/api/watchers?date=${DATE}&now=${encodeURIComponent(NOW)}` });
    const w = res.json().data.watchers[0];
    expect(w.kind).toBe("B");
    expect(w.manualExogenous).not.toBeNull();
    expect(w.manualExogenous.sourceStability).toBe("volatile");
  });
});

describe("POST /api/watchers/:id/manual-log", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  const OBSERVED_AT = "2026-06-22T09:00:00.000Z";

  async function createManualB(app: ReturnType<typeof buildServer>): Promise<number> {
    const res = await app.inject({
      method: "POST",
      url: "/api/watchers/manual-exogenous",
      payload: { label: "test", sourceStability: "unknown" }
    });
    return res.json().data.watcher.id as number;
  }

  it("creates a log and returns log + 30-day summary", async () => {
    const app = buildServer(conn.db);
    const id = await createManualB(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/watchers/${id}/manual-log`,
      payload: { outcome: "signal_seen", observedAt: OBSERVED_AT }
    });
    expect(res.statusCode).toBe(201);
    const { log, summary } = res.json().data;
    expect(log.outcome).toBe("signal_seen");
    expect(summary.signalSeenCount).toBe(1);
    expect(summary.manualLogCount).toBe(1);
  });

  it("returns 404 when watcher not found", async () => {
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "POST",
      url: "/api/watchers/9999/manual-log",
      payload: { outcome: "checked_no_signal", observedAt: OBSERVED_AT }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 409 when watcher is kind=A (wrong type)", async () => {
    const app = buildServer(conn.db);
    const createRes = await app.inject({
      method: "POST",
      url: "/api/watchers",
      payload: { label: "A watcher", threshold: "2026-07-01" }
    });
    const kindAId = createRes.json().data.id as number;
    const res = await app.inject({
      method: "POST",
      url: `/api/watchers/${kindAId}/manual-log`,
      payload: { outcome: "checked_no_signal", observedAt: OBSERVED_AT }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("WRONG_WATCHER_TYPE");
  });

  it("returns 400 for invalid outcome", async () => {
    const app = buildServer(conn.db);
    const id = await createManualB(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/watchers/${id}/manual-log`,
      payload: { outcome: "not_valid", observedAt: OBSERVED_AT }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("accumulates multiple logs correctly in summary", async () => {
    const app = buildServer(conn.db);
    const id = await createManualB(app);
    await app.inject({ method: "POST", url: `/api/watchers/${id}/manual-log`, payload: { outcome: "signal_seen", observedAt: OBSERVED_AT } });
    await app.inject({ method: "POST", url: `/api/watchers/${id}/manual-log`, payload: { outcome: "missed_signal", observedAt: OBSERVED_AT } });
    const res = await app.inject({ method: "POST", url: `/api/watchers/${id}/manual-log`, payload: { outcome: "checked_no_signal", observedAt: OBSERVED_AT } });
    const { summary } = res.json().data;
    expect(summary.manualLogCount).toBe(3);
    expect(summary.signalSeenCount).toBe(1);
    expect(summary.missedSignalCount).toBe(1);
    expect(summary.checkedNoSignalCount).toBe(1);
  });
});
