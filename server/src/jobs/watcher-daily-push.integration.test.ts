import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { createWatcher } from "../repositories/watchers.js";
import { runWatcherDailyPush } from "./watcher-daily-push.js";

const DATE = "2026-06-23";
const NOW = "2026-06-23T09:00:00+09:00";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-push-job-test-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("runWatcherDailyPush — no due watchers", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("returns sentCount=0 and no sender call when no watchers", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await runWatcherDailyPush(conn.db, sender, { date: DATE, now: NOW });
    expect(result.sentCount).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it("returns sentCount=0 when all watchers are future", async () => {
    createWatcher(conn.db, { label: "미래 watcher", threshold: "2026-12-01" });
    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await runWatcherDailyPush(conn.db, sender, { date: DATE, now: NOW });
    expect(result.sentCount).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("runWatcherDailyPush — due watchers", () => {
  let conn: SqliteConnection;
  beforeEach(() => { conn = makeTestDb(); });

  it("calls sender exactly once with digest when two due watchers", async () => {
    createWatcher(conn.db, { label: "watcher A", threshold: "2026-06-20" });
    createWatcher(conn.db, { label: "watcher B", threshold: "2026-06-21" });
    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await runWatcherDailyPush(conn.db, sender, { date: DATE, now: NOW });
    expect(result.sentCount).toBe(2);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]![0]).toContain("watcher A");
    expect(sender.mock.calls[0]![0]).toContain("watcher B");
  });

  it("marks last_fired for sent watcher ids (stores local date, blocks same-date retry)", async () => {
    createWatcher(conn.db, { label: "fired watcher", threshold: "2026-06-20" });
    const sender = vi.fn().mockResolvedValue(undefined);
    await runWatcherDailyPush(conn.db, sender, { date: DATE, now: NOW });

    // Re-run same date: should skip because last_fired is now set to DATE
    const sender2 = vi.fn().mockResolvedValue(undefined);
    const result2 = await runWatcherDailyPush(conn.db, sender2, { date: DATE, now: NOW });
    expect(result2.sentCount).toBe(0);
    expect(sender2).not.toHaveBeenCalled();
  });

  it("repeat same date produces no duplicate sender call", async () => {
    createWatcher(conn.db, { label: "watcher X", threshold: "2026-06-20" });
    const sender = vi.fn().mockResolvedValue(undefined);
    await runWatcherDailyPush(conn.db, sender, { date: DATE, now: NOW });
    await runWatcherDailyPush(conn.db, sender, { date: DATE, now: NOW });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("does not update last_fired when sender throws", async () => {
    createWatcher(conn.db, { label: "fail watcher", threshold: "2026-06-20" });
    const failSender = vi.fn().mockRejectedValue(new Error("Telegram 실패"));
    const result = await runWatcherDailyPush(conn.db, failSender, { date: DATE, now: NOW });
    expect(result.sentCount).toBe(0);
    expect(result.error).toContain("Telegram 실패");

    // Retry should still send
    const retrySender = vi.fn().mockResolvedValue(undefined);
    const result2 = await runWatcherDailyPush(conn.db, retrySender, { date: DATE, now: NOW });
    expect(result2.sentCount).toBe(1);
    expect(retrySender).toHaveBeenCalledTimes(1);
  });

  it("missing Telegram config: graceful failure with no mutation", async () => {
    createWatcher(conn.db, { label: "watcher Y", threshold: "2026-06-20" });
    // Simulate missing config by passing a sender that immediately throws config error
    const noConfigSender = vi.fn().mockRejectedValue(new Error("TELEGRAM_BOT_TOKEN not set"));
    const result = await runWatcherDailyPush(conn.db, noConfigSender, { date: DATE, now: NOW });
    expect(result.error).toBeDefined();
    expect(result.sentCount).toBe(0);

    // last_fired should be unset → retry works
    const goodSender = vi.fn().mockResolvedValue(undefined);
    const result2 = await runWatcherDailyPush(conn.db, goodSender, { date: DATE, now: NOW });
    expect(result2.sentCount).toBe(1);
  });
});
