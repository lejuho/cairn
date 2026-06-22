import type { CairnDatabase } from "../db/index.js";
import { runWatcherDailyPush, type WatcherDailyPushJobResult, type WatcherPushSender } from "./watcher-daily-push.js";

export type WatcherSchedulerConfig = {
  enabled: boolean;
  botToken: string | undefined;
  chatId: string | undefined;
  hour: number;   // validated 0-23
  minute: number; // validated 0-59
};

export type WatcherSchedulerHandle = { stop: () => void };

// Extracted so index.ts can pass typed, pre-read config and tests can inject it.
export function parseSchedulerConfig(): WatcherSchedulerConfig {
  const enabled = process.env.WATCHER_DAILY_PUSH_ENABLED === "true";
  const hour = Number.parseInt(process.env.WATCHER_DAILY_PUSH_HOUR ?? "9", 10);
  const minute = Number.parseInt(process.env.WATCHER_DAILY_PUSH_MINUTE ?? "0", 10);
  return {
    enabled,
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    hour,
    minute
  };
}

export function startWatcherDailyPushScheduler(
  db: CairnDatabase,
  config: WatcherSchedulerConfig,
  sender: WatcherPushSender,
  opts?: {
    logError?: (msg: string) => void;
    logInfo?: (msg: string) => void;
    nowFn?: () => Date; // for testing
    // Overrides the full job runner — used in unit tests to bypass DB.
    runJob?: (sender: WatcherPushSender) => Promise<WatcherDailyPushJobResult>;
  }
): WatcherSchedulerHandle | null {
  const logError = opts?.logError ?? ((msg) => console.error("[watcher-push]", msg));
  const logInfo = opts?.logInfo ?? ((msg) => console.log("[watcher-push]", msg));
  const nowFn = opts?.nowFn ?? (() => new Date());
  const runJob = opts?.runJob ?? ((s) => runWatcherDailyPush(db, s));

  if (!config.enabled) return null;

  if (!config.botToken || !config.chatId) {
    logError("WATCHER_DAILY_PUSH_ENABLED=true but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing — scheduler not started");
    return null;
  }

  if (
    Number.isNaN(config.hour) ||
    config.hour < 0 ||
    config.hour > 23 ||
    Number.isNaN(config.minute) ||
    config.minute < 0 ||
    config.minute > 59
  ) {
    logError(`Invalid scheduler time: hour=${config.hour} minute=${config.minute} — must be 0-23 and 0-59`);
    return null;
  }

  let running = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  const fire = () => {
    if (running) return;
    running = true;
    void runJob(sender)
      .then((result) => {
        logInfo(`sent=${result.sentCount} skipped=${result.skippedCount}${result.error ? ` error=${result.error}` : ""}`);
      })
      .catch((e: unknown) => {
        logError(String(e));
      })
      .finally(() => {
        running = false;
      });
  };

  const msUntilFirst = msUntilNextLocalTime(config.hour, config.minute, nowFn());
  logInfo(`first run in ${Math.round(msUntilFirst / 60_000)} min`);

  timeoutHandle = setTimeout(() => {
    fire();
    // 24h fixed interval — no DST adjustment needed (Pi runs KST, UTC+9 fixed).
    intervalHandle = setInterval(fire, 24 * 60 * 60 * 1_000);
  }, msUntilFirst);

  return {
    stop() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (intervalHandle) clearInterval(intervalHandle);
    }
  };
}

// Exported for unit tests.
export function msUntilNextLocalTime(hour: number, minute: number, now: Date = new Date()): number {
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
    0
  );
  const ms = target.getTime() - now.getTime();
  return ms > 0 ? ms : ms + 24 * 60 * 60 * 1_000;
}
