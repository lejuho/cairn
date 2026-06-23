import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "./index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("core SQLite migration", () => {
  it("creates all spec 0.2 tables", () => {
    const { sqlite } = migratedDatabase();
    const tables = sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations' order by name"
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "annotations",
      "event_people",
      "events",
      "links",
      "params",
      "people",
      "resource_links",
      "resources",
      "tasks",
      "thread_links",
      "threads",
      "watcher_logs",
      "watchers"
    ]);
    sqlite.close();
  });

  it("enables FK checks and rejects invalid persisted values", () => {
    const { sqlite } = migratedDatabase();
    const foreignKeys = sqlite.pragma("foreign_keys", { simple: true });
    expect(foreignKeys).toBe(1);

    expect(() => {
      sqlite.prepare("insert into events (title, status) values (?, ?)").run("Bad", "PLANNED");
    }).toThrow();

    expect(() => {
      sqlite.prepare("insert into events (thread_id, title) values (?, ?)").run(999, "Missing");
    }).toThrow();

    sqlite.close();
  });

  it("rejects duplicate event_people pairs", () => {
    const { sqlite } = migratedDatabase();
    const eventId = Number(
      sqlite.prepare("insert into events (title) values (?)").run("Coffee").lastInsertRowid
    );
    const personId = Number(
      sqlite.prepare("insert into people (name) values (?)").run("Ari").lastInsertRowid
    );

    sqlite
      .prepare("insert into event_people (event_id, person_id) values (?, ?)")
      .run(eventId, personId);

    expect(() => {
      sqlite
        .prepare("insert into event_people (event_id, person_id) values (?, ?)")
        .run(eventId, personId);
    }).toThrow();

    sqlite.close();
  });
});

function migratedDatabase(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-sqlite-"));
  tempDirs.push(dir);
  const connection = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(connection);
  return connection;
}
