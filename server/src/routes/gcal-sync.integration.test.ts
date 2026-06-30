import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import type { GcalClient } from "../gcal/client.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-gcal-route-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

function makeEnv(dir: string, tokenPath = join(dir, "gcal-token.json")): NodeJS.ProcessEnv {
  return {
    GCAL_CLIENT_ID: "test-client",
    GCAL_CLIENT_SECRET: "test-secret",
    CAIRN_TOKEN_PATH: tokenPath,
    CAIRN_TIME_ZONE: "Asia/Seoul"
  };
}

function currentTempDir(): string {
  const dir = tempDirs[0];
  if (!dir) throw new Error("test temp dir was not created");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("GET /api/sync/gcal/status", () => {
  it("reports missing OAuth configuration without exposing secrets", async () => {
    const conn = makeTestDb();
    const dir = currentTempDir();
    const app = buildServer(conn.db, undefined, undefined, undefined, {
      gcalSync: { connection: conn, env: {}, cwd: dir }
    });

    const res = await app.inject({ method: "GET", url: "/api/sync/gcal/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      state: "needs_config",
      configured: false,
      tokenPresent: false,
      syncTokenPresent: false,
      lastSyncAt: null
    });
    expect(JSON.stringify(res.json())).not.toContain("test-secret");
    conn.sqlite.close();
  });
});

describe("POST /api/sync/gcal/run", () => {
  it("rejects manual sync until config and token are present", async () => {
    const conn = makeTestDb();
    const dir = currentTempDir();
    const app = buildServer(conn.db, undefined, undefined, undefined, {
      gcalSync: { connection: conn, env: {}, cwd: dir }
    });

    const res = await app.inject({ method: "POST", url: "/api/sync/gcal/run" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("GCAL_NOT_READY");
    conn.sqlite.close();
  });

  it("runs sync with a ready token and returns import counts", async () => {
    const conn = makeTestDb();
    const dir = currentTempDir();
    const tokenPath = join(dir, "token.json");
    writeFileSync(tokenPath, "{}", "utf8");
    const env = makeEnv(dir, tokenPath);
    const client: GcalClient = {
      async list() {
        return {
          items: [{
            id: "evt-route-1",
            summary: "Route sync",
            status: "confirmed",
            start: { dateTime: "2026-06-29T10:00:00+09:00" },
            end: { dateTime: "2026-06-29T11:00:00+09:00" },
            iCalUID: "evt-route-1@google.com",
            etag: "\"route\"",
            updated: "2026-06-28T12:00:00.000Z"
          }],
          nextPageToken: null,
          nextSyncToken: "route-sync-token"
        };
      }
    };
    const app = buildServer(conn.db, undefined, undefined, undefined, {
      gcalSync: { connection: conn, env, cwd: dir, createClient: async () => client }
    });

    const res = await app.inject({ method: "POST", url: "/api/sync/gcal/run" });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.result).toEqual({ upserted: 1, cancelled: 0, skipped: 0 });
    expect(res.json().data.status.state).toBe("connected");
    const row = conn.sqlite.prepare("SELECT source FROM events WHERE external_event_id = ?").get("evt-route-1") as { source: string };
    expect(row.source).toBe("gcal");
    conn.sqlite.close();
  });
});
