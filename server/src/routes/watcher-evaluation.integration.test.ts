import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const DATE = "2026-06-22";
const NOW = "2026-06-22T09:00:00+00:00";
const ENC_NOW = encodeURIComponent(NOW);
const TODAY_URL = `/api/today?date=${DATE}&now=${ENC_NOW}`;

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-watcher-eval-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function insertWatcher(
  conn: SqliteConnection,
  opts: {
    label?: string;
    threshold?: string | null;
    rule?: string | null;
    armed?: number;
    kind?: string;
    snoozedUntil?: string | null;
  } = {}
): number {
  const threshold = "threshold" in opts ? opts.threshold : "2026-06-22";
  const rule = "rule" in opts
    ? opts.rule
    : JSON.stringify({ type: "date_threshold", fireOn: threshold ?? "2026-06-22" });
  const res = conn.sqlite
    .prepare(
      `INSERT INTO watchers (label, threshold, rule, armed, kind, category, snoozed_until)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      opts.label ?? "Test Watcher",
      threshold,
      rule,
      opts.armed ?? 1,
      opts.kind ?? "A",
      opts.snoozedUntil ?? null
    );
  return Number(res.lastInsertRowid);
}

describe("GET /api/today — derived watcher bubbles", () => {
  it("returns derived bubble fields (daysOverdue, reasonCodes, message)", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, { threshold: "2026-06-20" }); // 2 days overdue
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    expect(res.statusCode).toBe(200);
    const bubble = res.json().data.watcherBubbles[0];
    expect(bubble.daysOverdue).toBe(2);
    expect(bubble.reasonCodes).toEqual(["date_threshold_due"]);
    expect(bubble.message).toBe("2일 지난 watcher야");
    expect(bubble).not.toHaveProperty("lastFired");
    expect(bubble).not.toHaveProperty("armed");
    conn.sqlite.close();
  });

  it("returns message '오늘 확인할 watcher야' for same-day threshold", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, { threshold: "2026-06-22" });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    const bubble = res.json().data.watcherBubbles[0];
    expect(bubble.message).toBe("오늘 확인할 watcher야");
    expect(bubble.daysOverdue).toBe(0);
    conn.sqlite.close();
  });

  it("hides future threshold watcher", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, { threshold: "2026-12-31", rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-12-31" }) });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    expect(res.json().data.watcherBubbles).toHaveLength(0);
    conn.sqlite.close();
  });

  it("hides armed=0 watcher", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, { armed: 0 });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    expect(res.json().data.watcherBubbles).toHaveLength(0);
    conn.sqlite.close();
  });

  it("hides watcher with active snooze", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, { snoozedUntil: "2026-12-31T00:00:00+00:00" });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    expect(res.json().data.watcherBubbles).toHaveLength(0);
    conn.sqlite.close();
  });

  it("surfaces watcher when snooze has expired", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, { snoozedUntil: "2026-01-01T00:00:00+00:00" });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    expect(res.json().data.watcherBubbles).toHaveLength(1);
    conn.sqlite.close();
  });

  it("does not crash when rule is malformed JSON", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, { rule: "not-json", threshold: "2026-06-22" });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    expect(res.statusCode).toBe(200);
    // Falls back to threshold column
    expect(res.json().data.watcherBubbles).toHaveLength(1);
    conn.sqlite.close();
  });

  it("does not crash when rule is unsupported type and threshold missing", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, {
      rule: JSON.stringify({ type: "keyword", query: "foo" }),
      threshold: null
    });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    expect(res.statusCode).toBe(200);
    // Hidden — no valid threshold
    expect(res.json().data.watcherBubbles).toHaveLength(0);
    conn.sqlite.close();
  });

  it("does not mutate watcher state on GET /api/today", async () => {
    const conn = makeTestDb();
    const id = insertWatcher(conn, { threshold: "2026-06-22" });
    const app = buildServer(conn.db);

    const before = conn.sqlite.prepare("SELECT last_fired, snoozed_until FROM watchers WHERE id = ?").get(id) as { last_fired: null; snoozed_until: null };

    await app.inject({ method: "GET", url: TODAY_URL });
    await app.inject({ method: "GET", url: TODAY_URL });

    const after = conn.sqlite.prepare("SELECT last_fired, snoozed_until FROM watchers WHERE id = ?").get(id) as { last_fired: null; snoozed_until: null };
    expect(after.last_fired).toBe(before.last_fired);
    expect(after.snoozed_until).toBe(before.snoozed_until);
    conn.sqlite.close();
  });

  it("sorts multiple watchers threshold asc then id asc", async () => {
    const conn = makeTestDb();
    insertWatcher(conn, { label: "B", threshold: "2026-06-21", rule: null });
    insertWatcher(conn, { label: "A", threshold: "2026-06-20", rule: null });
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    const bubbles = res.json().data.watcherBubbles as { label: string }[];
    expect(bubbles.map((b) => b.label)).toEqual(["A", "B"]);
    conn.sqlite.close();
  });

  it("watcher card in cards array uses bubble shape", async () => {
    const conn = makeTestDb();
    insertWatcher(conn);
    const app = buildServer(conn.db);
    const res = await app.inject({ method: "GET", url: TODAY_URL });
    const card = res.json().data.cards.find((c: { kind: string }) => c.kind === "watcher");
    expect(card).toBeDefined();
    expect(card.watcher.reasonCodes).toEqual(["date_threshold_due"]);
    conn.sqlite.close();
  });
});
