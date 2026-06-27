import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import type { GmailClient, GmailMessage, GmailMessageRef } from "../gmail/client.js";
import { buildEventQuery, runGmailCostSync } from "./gmail-cost-sync.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-gmail-sync-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
  vi.restoreAllMocks();
});

const NOW = "2026-06-16T00:00:00+09:00";

function seedCandidate(conn: SqliteConnection, title: string, extId: string): number {
  const info = conn.sqlite
    .prepare(`
      INSERT INTO events (title, start, end, source, self_imposed, status, cancel_money, refund_cutoff, external_calendar_id, external_event_id)
      VALUES (?, ?, ?, 'gcal', 0, 'planned', 0, NULL, 'primary', ?)
    `)
    .run(title, "2026-06-20T19:00:00+09:00", "2026-06-20T21:00:00+09:00", extId);
  return Number(info.lastInsertRowid);
}

function getEvent(conn: SqliteConnection, id: number): { cancel_money: number; refund_cutoff: string | null } {
  return conn.sqlite
    .prepare("SELECT cancel_money, refund_cutoff FROM events WHERE id = ?")
    .get(id) as { cancel_money: number; refund_cutoff: string | null };
}

function msg(id: string, body: string): GmailMessage {
  return { id, subject: "예약 안내", snippet: "", body };
}

function fakeClient(impl: {
  search?: (q: string, limit: number) => Promise<GmailMessageRef[]>;
  get?: (id: string) => Promise<GmailMessage>;
}): GmailClient {
  return {
    searchMessages: impl.search ?? (async () => []),
    getMessage: impl.get ?? (async (id) => msg(id, ""))
  };
}

describe("buildEventQuery", () => {
  it("builds a bounded query from distinctive title tokens and the event date", () => {
    const q = buildEventQuery({ title: "강남 치과 예약", start: "2026-06-20T19:00:00+09:00" });
    expect(q).not.toBeNull();
    expect(q).toContain('"강남" OR "치과"');
    expect(q).toContain("(취소 OR 환불 OR 위약금 OR 수수료)");
    expect(q).toContain("after:2026/03/22");
    expect(q).toContain("before:2026/06/22");
  });

  it("returns null when the title has only generic tokens", () => {
    expect(buildEventQuery({ title: "영화", start: "2026-06-20T19:00:00+09:00" })).toBeNull();
    expect(buildEventQuery({ title: "예약", start: "2026-06-20T19:00:00+09:00" })).toBeNull();
  });

  it("returns null when start is missing", () => {
    expect(buildEventQuery({ title: "강남 치과", start: null })).toBeNull();
  });
});

describe("runGmailCostSync", () => {
  it("applies high-confidence evidence to an empty candidate event", async () => {
    const conn = makeTestDb();
    const id = seedCandidate(conn, "강남 치과", "evt-a");
    const client = fakeClient({
      search: async () => [{ id: "m1" }],
      get: async () => msg("m1", "예약 취소 시 취소 수수료 12,000원 / 6월 30일까지 무료 취소")
    });

    const result = await runGmailCostSync({ connection: conn, client, now: NOW });
    expect(result).toEqual({ scanned: 1, messages: 1, updated: 1, skipped: 0 });
    expect(getEvent(conn, id)).toEqual({ cancel_money: 12000, refund_cutoff: "2026-06-30" });
  });

  it("skips a candidate whose title is too generic to search", async () => {
    const conn = makeTestDb();
    const id = seedCandidate(conn, "예약", "evt-a");
    const search = vi.fn(async () => [{ id: "m1" }]);
    const client = fakeClient({ search });

    const result = await runGmailCostSync({ connection: conn, client, now: NOW });
    expect(search).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, messages: 0, updated: 0, skipped: 1 });
    expect(getEvent(conn, id)).toEqual({ cancel_money: 0, refund_cutoff: null });
  });

  it("does not update when no message has high-confidence evidence", async () => {
    const conn = makeTestDb();
    const id = seedCandidate(conn, "강남 치과", "evt-a");
    const client = fakeClient({
      search: async () => [{ id: "m1" }],
      get: async () => msg("m1", "결제금액 12000원 결제가 완료되었습니다.")
    });

    const result = await runGmailCostSync({ connection: conn, client, now: NOW });
    expect(result).toEqual({ scanned: 1, messages: 1, updated: 0, skipped: 1 });
    expect(getEvent(conn, id)).toEqual({ cancel_money: 0, refund_cutoff: null });
  });

  it("chooses deterministic evidence (lowest message id) when multiple match", async () => {
    const conn = makeTestDb();
    const id = seedCandidate(conn, "강남 치과", "evt-a");
    const bodies: Record<string, string> = {
      m1: "취소 수수료 5,000원",
      m2: "취소 수수료 9,000원"
    };
    // Search returns them out of order; sync must sort by id deterministically.
    const client = fakeClient({
      search: async () => [{ id: "m2" }, { id: "m1" }],
      get: async (mid) => msg(mid, bodies[mid] ?? "")
    });

    const result = await runGmailCostSync({ connection: conn, client, now: NOW });
    expect(result.updated).toBe(1);
    expect(getEvent(conn, id).cancel_money).toBe(5000);
  });

  it("aborts on Gmail search error without writing", async () => {
    const conn = makeTestDb();
    const id = seedCandidate(conn, "강남 치과", "evt-a");
    const client = fakeClient({
      search: async () => {
        throw new Error("gmail 503");
      }
    });

    await expect(runGmailCostSync({ connection: conn, client, now: NOW })).rejects.toThrow("gmail 503");
    expect(getEvent(conn, id)).toEqual({ cancel_money: 0, refund_cutoff: null });
  });

  it("aborts on Gmail getMessage error without a partial write for the event", async () => {
    const conn = makeTestDb();
    const id = seedCandidate(conn, "강남 치과", "evt-a");
    const client = fakeClient({
      search: async () => [{ id: "m1" }],
      get: async () => {
        throw new Error("gmail get failed");
      }
    });

    await expect(runGmailCostSync({ connection: conn, client, now: NOW })).rejects.toThrow("gmail get failed");
    expect(getEvent(conn, id)).toEqual({ cancel_money: 0, refund_cutoff: null });
  });
});
