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
