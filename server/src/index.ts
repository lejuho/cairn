import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { buildServer } from "./app.js";
import { createSqliteConnection, runMigrations } from "./db/index.js";
import { createLlmGateway } from "./llm/gateway.js";
import { readMapConfig } from "./maps/config.js";
import { createMapGateway } from "./maps/gateway.js";
import { readPlaceSearchConfig } from "./naver/place-search-config.js";
import { createPlaceSearchGateway } from "./naver/place-search-gateway.js";
import { createTelegramWorkerFromEnv } from "./telegram/worker.js";
import { createTelegramClient } from "./telegram/client.js";
import { startObservationExtractor } from "./jobs/observation-extractor.js";
import { parseSchedulerConfig, startWatcherDailyPushScheduler } from "./jobs/watcher-push-scheduler.js";

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), "cairn.sqlite3");
  const connection = createSqliteConnection(dbPath);
  runMigrations(connection);

  const gateway = createLlmGateway();
  // Map provider gateway from env (cycle-72); defaults to disabled, needs no DB.
  const mapGateway = createMapGateway(readMapConfig());
  // Naver place-search gateway from env (cycle-79); defaults to disabled, needs no DB.
  const placeSearchGateway = createPlaceSearchGateway(readPlaceSearchConfig());
  const app = buildServer(connection.db, gateway, mapGateway, placeSearchGateway, {
    gcalSync: { connection },
    ingestToken: process.env.CAIRN_INGEST_TOKEN || undefined
  });
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

  // 관찰 추출은 배치로 여러 알림을 한 번에 보내므로 대화용 gateway 보다 timeout 을 길게 둔다.
  const extractor = process.env.OBSERVATION_EXTRACTOR_ENABLED === "0"
    ? null
    : startObservationExtractor(connection.db, createLlmGateway({ timeoutMs: 90_000, retryCount: 0 }));

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    telegramWorker?.stop();
    watcherScheduler?.stop();
    extractor?.stop();
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
