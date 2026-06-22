import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { buildServer } from "./app.js";
import { createSqliteConnection, runMigrations } from "./db/index.js";
import { createLlmGateway } from "./llm/gateway.js";
import { createTelegramWorkerFromEnv } from "./telegram/worker.js";
import { createTelegramClient } from "./telegram/client.js";
import { parseSchedulerConfig, startWatcherDailyPushScheduler } from "./jobs/watcher-push-scheduler.js";

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

  const schedulerConfig = parseSchedulerConfig();
  const watcherSender = schedulerConfig.botToken && schedulerConfig.chatId
    ? (() => {
        const client = createTelegramClient({
          botToken: schedulerConfig.botToken!,
          forceIpv4: process.env.TELEGRAM_FORCE_IPV4 === "1"
        });
        return (message: string) =>
          client.sendMessage({ chatId: schedulerConfig.chatId!, text: message }).then(() => undefined);
      })()
    : (() => Promise.reject(new Error("Telegram not configured")));
  const watcherScheduler = startWatcherDailyPushScheduler(connection.db, schedulerConfig, watcherSender);

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

