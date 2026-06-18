import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { buildServer } from "./app.js";
import { createSqliteConnection, runMigrations } from "./db/index.js";
import { createLlmGateway } from "./llm/gateway.js";
import { createTelegramWorkerFromEnv } from "./telegram/worker.js";

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

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    telegramWorker?.stop();
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
