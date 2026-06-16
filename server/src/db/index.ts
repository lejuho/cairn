import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type CairnDatabase = BetterSQLite3Database<typeof schema>;

export type SqliteConnection = {
  sqlite: Database.Database;
  db: CairnDatabase;
};

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function createSqliteConnection(filename: string): SqliteConnection {
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export function runMigrations(
  connection: SqliteConnection,
  folder = migrationsFolder
): void {
  migrate(connection.db, { migrationsFolder: folder });
}
