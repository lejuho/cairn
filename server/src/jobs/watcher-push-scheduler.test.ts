import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  msUntilNextLocalTime,
  startWatcherDailyPushScheduler,
  type WatcherSchedulerConfig
} from "./watcher-push-scheduler.js";

// Minimal stub — scheduler only calls runWatcherDailyPush via the injected sender
const STUB_DB = {} as Parameters<typeof startWatcherDailyPushScheduler>[0];

const BASE_CONFIG: WatcherSchedulerConfig = {
  enabled: true,
  botToken: "tok",
  chatId: "123",
  hour: 9,
  minute: 0
};

// Fixed "now": 2026-06-23 08:00:00 local time
const NOW_08H = new Date(2026, 5, 23, 8, 0, 0, 0); // local Date

afterEach(() => {
  vi.useRealTimers();
});

describe("startWatcherDailyPushScheduler — disabled / config guards", () => {
  it("returns null when enabled=false", () => {
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, enabled: false },
      vi.fn()
    );
    expect(handle).toBeNull();
  });

  it("returns null and logs error when botToken missing", () => {
    const logs: string[] = [];
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, botToken: undefined },
      vi.fn(),
      { logError: (m) => logs.push(m) }
    );
    expect(handle).toBeNull();
    expect(logs[0]).toMatch(/TELEGRAM_BOT_TOKEN/);
  });

  it("returns null and logs error when chatId missing", () => {
    const logs: string[] = [];
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, chatId: undefined },
      vi.fn(),
      { logError: (m) => logs.push(m) }
    );
    expect(handle).toBeNull();
    expect(logs[0]).toMatch(/TELEGRAM_CHAT_ID/);
  });

  it("returns null when hour is NaN", () => {
    const logs: string[] = [];
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, hour: NaN },
      vi.fn(),
      { logError: (m) => logs.push(m) }
    );
    expect(handle).toBeNull();
    expect(logs[0]).toMatch(/Invalid scheduler time/);
  });

  it("returns null when hour is out of range (99)", () => {
    const logs: string[] = [];
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, hour: 99 },
      vi.fn(),
      { logError: (m) => logs.push(m) }
    );
    expect(handle).toBeNull();
    expect(logs[0]).toMatch(/Invalid scheduler time/);
  });

  it("returns null when minute is NaN", () => {
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, minute: NaN },
      vi.fn()
    );
    expect(handle).toBeNull();
  });

  it("returns null when minute is out of range (60)", () => {
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, minute: 60 },
      vi.fn()
    );
    expect(handle).toBeNull();
  });
});

// runJob stub: bypasses DB, calls sender, returns success result
function makeRunJob() {
  return async (s: (msg: string) => Promise<void>) => {
    await s("digest");
    return { sentCount: 1, skippedCount: 0 };
  };
}

describe("startWatcherDailyPushScheduler — valid config timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("schedules first fire at configured hour:minute (future today)", async () => {
    // now=08:00, target=09:00 → 1h = 3_600_000 ms
    const sender = vi.fn().mockResolvedValue(undefined);
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, hour: 9, minute: 0 },
      sender,
      { nowFn: () => NOW_08H, runJob: makeRunJob() }
    );
    expect(handle).not.toBeNull();
    expect(sender).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(sender).toHaveBeenCalledTimes(1);

    handle!.stop();
  });

  it("schedules first fire next day when configured time already passed", async () => {
    // now=10:00, target=09:00 → already passed → next day (+23h)
    const now10 = new Date(2026, 5, 23, 10, 0, 0, 0);
    const sender = vi.fn().mockResolvedValue(undefined);
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, hour: 9, minute: 0 },
      sender,
      { nowFn: () => now10, runJob: makeRunJob() }
    );

    // Advance <1h — should not fire
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(sender).not.toHaveBeenCalled();

    // Advance 23h total → reaches next-day 09:00 (23h from 10:00)
    await vi.advanceTimersByTimeAsync(22 * 3_600_000);
    expect(sender).toHaveBeenCalledTimes(1);

    handle!.stop();
  });

  it("fires again after 24h interval", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, hour: 9, minute: 0 },
      sender,
      { nowFn: () => NOW_08H, runJob: makeRunJob() }
    );

    await vi.advanceTimersByTimeAsync(3_600_000); // first fire
    await vi.advanceTimersByTimeAsync(24 * 3_600_000); // second fire
    expect(sender).toHaveBeenCalledTimes(2);

    handle!.stop();
  });
});

describe("startWatcherDailyPushScheduler — overlap guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("skips second fire while first is still running", async () => {
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((res) => { resolveFirst = res; });
    let senderCallCount = 0;
    const sender = vi.fn().mockImplementation(() => {
      senderCallCount++;
      return firstDone; // never resolves until we call resolveFirst
    });
    // runJob that blocks until firstDone
    const runJob = async (s: (msg: string) => Promise<void>) => {
      await s("digest");
      return { sentCount: 1, skippedCount: 0 };
    };

    const handle = startWatcherDailyPushScheduler(
      STUB_DB,
      { ...BASE_CONFIG, hour: 9, minute: 0 },
      sender,
      { nowFn: () => NOW_08H, runJob }
    );

    await vi.advanceTimersByTimeAsync(3_600_000); // triggers first fire (running=true)
    await vi.advanceTimersByTimeAsync(24 * 3_600_000); // interval fires — running=true → skip
    expect(senderCallCount).toBe(1);

    // Stop timers before resolving so interval does not fire again after running resets.
    handle!.stop();
    resolveFirst();
  });
});

describe("msUntilNextLocalTime", () => {
  it("returns ms until target when target is later today", () => {
    const now = new Date(2026, 5, 23, 8, 0, 0, 0); // 08:00
    const ms = msUntilNextLocalTime(9, 0, now);
    expect(ms).toBe(3_600_000); // 1h
  });

  it("wraps to next day when target already passed", () => {
    const now = new Date(2026, 5, 23, 10, 0, 0, 0); // 10:00
    const ms = msUntilNextLocalTime(9, 0, now);
    expect(ms).toBe(23 * 3_600_000); // 23h until 09:00 next day
  });

  it("returns 24h when now is exactly at target", () => {
    const now = new Date(2026, 5, 23, 9, 0, 0, 0);
    const ms = msUntilNextLocalTime(9, 0, now);
    expect(ms).toBe(24 * 3_600_000);
  });
});
