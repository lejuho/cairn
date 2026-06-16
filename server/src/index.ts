import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { buildServer } from "./app.js";
import { createSqliteConnection, runMigrations } from "./db/index.js";

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), "cairn.sqlite3");
  const connection = createSqliteConnection(dbPath);
  runMigrations(connection);

  const app = buildServer(connection.db);
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ host, port });
}
