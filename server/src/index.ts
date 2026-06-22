import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { buildServer } from "./app.js";
import { createSqliteConnection, runMigrations } from "./db/index.js";
import { createLlmGateway } from "./llm/gateway.js";
import { createTelegramWorkerFromEnv } from "./telegram/worker.js";
import { createTelegramClient } from "./telegram/client.js";
import { runWatcherDailyPush } from "./jobs/watcher-daily-push.js";

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), "cairn.sqlite3");
  const connection = createSqliteConnection(dbPath);
  runMigrations(connection);

  const gateway = createLlmGateway();
  const app = buildServer(connection.db, gateway);
  const port = Number.parseInt(process.env.PORT ?? "3100", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ host, port });

  const telegramWorker = createTelegramWorkerFromEnv({
    db: connection.db,
    gateway,
    logError: (error) => console.error("[telegram]", error)
  });

  if (telegramWorker) {
    void telegramWorker.start().catch((error) => {
      console.error("[telegram]", error);
    });
  }

  const watcherScheduler = startWatcherDailyPushScheduler(connection.db);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    telegramWorker?.stop();
    watcherScheduler?.stop();
    try {
      await app.close();
    } finally {
      connection.sqlite.close();
    }
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

type WatcherSchedulerHandle = { stop: () => void };

function startWatcherDailyPushScheduler(
  db: Parameters<typeof runWatcherDailyPush>[0]
): WatcherSchedulerHandle | null {
  if (process.env.WATCHER_DAILY_PUSH_ENABLED !== "true") return null;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.error("[watcher-push] WATCHER_DAILY_PUSH_ENABLED=true but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing — scheduler not started");
    return null;
  }

  const pushHour = Number.parseInt(process.env.WATCHER_DAILY_PUSH_HOUR ?? "9", 10);
  const pushMinute = Number.parseInt(process.env.WATCHER_DAILY_PUSH_MINUTE ?? "0", 10);

  const client = createTelegramClient({
    botToken,
    forceIpv4: process.env.TELEGRAM_FORCE_IPV4 === "1"
  });
  const sender = (message: string) =>
    client.sendMessage({ chatId, text: message }).then(() => undefined);

  let running = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  const fire = () => {
    if (running) return;
    running = true;
    void runWatcherDailyPush(db, sender)
      .then((result) => {
        console.log(`[watcher-push] sent=${result.sentCount} skipped=${result.skippedCount}${result.error ? ` error=${result.error}` : ""}`);
      })
      .catch((e: unknown) => {
        console.error("[watcher-push]", e);
      })
      .finally(() => {
        running = false;
      });
  };

  const msUntilFirst = msUntilNextLocalTime(pushHour, pushMinute);
  console.log(`[watcher-push] first run in ${Math.round(msUntilFirst / 60_000)} min`);

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

function msUntilNextLocalTime(hour: number, minute: number): number {
  const now = new Date();
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
