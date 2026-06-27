import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { findGmailCostCandidateEvents, applyGmailCostEvidence } from "./events.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-gmail-cost-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

type EventSeed = {
  title: string;
  start: string | null;
  source: string;
  selfImposed: number;
  status: string;
  cancelMoney?: number;
  refundCutoff?: string | null;
  extId?: string;
};

function insertEvent(conn: SqliteConnection, seed: EventSeed): number {
  const stmt = conn.sqlite.prepare(`
    INSERT INTO events (title, start, end, source, self_imposed, status, cancel_money, refund_cutoff, external_calendar_id, external_event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    seed.title,
    seed.start,
    seed.start,
    seed.source,
    seed.selfImposed,
    seed.status,
    seed.cancelMoney ?? 0,
    seed.refundCutoff ?? null,
    seed.source === "gcal" ? "primary" : null,
    seed.extId ?? null
  );
  return Number(info.lastInsertRowid);
}

function rowCount(conn: SqliteConnection, table: string): number {
  const r = conn.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
  return r.n;
}

function getEvent(conn: SqliteConnection, id: number): { cancel_money: number; refund_cutoff: string | null; updated_at: string | null } {
  return conn.sqlite
    .prepare("SELECT cancel_money, refund_cutoff, updated_at FROM events WHERE id = ?")
    .get(id) as { cancel_money: number; refund_cutoff: string | null; updated_at: string | null };
}

const NOW = "2026-06-16T00:00:00+09:00";
const LOOKAHEAD = 14;

describe("findGmailCostCandidateEvents", () => {
  it("selects only imminent external GCal events still missing a cost field", () => {
    const conn = makeTestDb();
    const a = insertEvent(conn, { title: "공연 예매", start: "2026-06-20T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "planned", extId: "evt-a" });
    // self-imposed Cairn event — not a candidate
    insertEvent(conn, { title: "내 작업", start: "2026-06-20T19:00:00+09:00", source: "cairn", selfImposed: 1, status: "planned" });
    // cancelled external — not a candidate
    insertEvent(conn, { title: "취소된 예약", start: "2026-06-20T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "cancelled", extId: "evt-c" });
    // past external — not a candidate
    insertEvent(conn, { title: "지난 예약", start: "2026-06-01T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "planned", extId: "evt-d" });
    // far-future external — not a candidate
    insertEvent(conn, { title: "먼 예약", start: "2026-07-20T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "planned", extId: "evt-e" });
    // fully populated external — not a candidate
    insertEvent(conn, { title: "비용 채워짐", start: "2026-06-21T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "confirmed", cancelMoney: 15000, refundCutoff: "2026-06-18", extId: "evt-f" });
    // partially populated (money set, cutoff null) external — still a candidate
    const g = insertEvent(conn, { title: "부분 채워짐", start: "2026-06-22T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "confirmed", cancelMoney: 5000, refundCutoff: null, extId: "evt-g" });

    const candidates = findGmailCostCandidateEvents(conn.db, NOW, LOOKAHEAD);
    expect(candidates.map((e) => e.id)).toEqual([a, g]);
  });

  it("returns empty when now cannot be parsed", () => {
    const conn = makeTestDb();
    insertEvent(conn, { title: "공연", start: "2026-06-20T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "planned", extId: "evt-a" });
    expect(findGmailCostCandidateEvents(conn.db, "not-a-date", LOOKAHEAD)).toEqual([]);
  });
});

describe("applyGmailCostEvidence", () => {
  it("fills empty cost fields and stamps updated_at", () => {
    const conn = makeTestDb();
    const id = insertEvent(conn, { title: "공연", start: "2026-06-20T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "planned", extId: "evt-a" });

    const r = applyGmailCostEvidence(conn.db, id, { cancelMoney: 12000, refundCutoff: "2026-06-19" }, "2026-06-16T10:00:00.000Z");
    expect(r).toEqual({ updatedMoney: true, updatedCutoff: true });
    const row = getEvent(conn, id);
    expect(row.cancel_money).toBe(12000);
    expect(row.refund_cutoff).toBe("2026-06-19");
    expect(row.updated_at).toBe("2026-06-16T10:00:00.000Z");
  });

  it("preserves an existing nonzero cancel_money and existing refund_cutoff", () => {
    const conn = makeTestDb();
    const id = insertEvent(conn, { title: "비용 채워짐", start: "2026-06-21T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "confirmed", cancelMoney: 15000, refundCutoff: "2026-06-18", extId: "evt-f" });

    const r = applyGmailCostEvidence(conn.db, id, { cancelMoney: 99999, refundCutoff: "2099-01-01" }, "2026-06-16T10:00:00.000Z");
    expect(r).toEqual({ updatedMoney: false, updatedCutoff: false });
    const row = getEvent(conn, id);
    expect(row.cancel_money).toBe(15000);
    expect(row.refund_cutoff).toBe("2026-06-18");
    expect(row.updated_at).toBeNull();
  });

  it("fills only the empty field when partially populated", () => {
    const conn = makeTestDb();
    const id = insertEvent(conn, { title: "부분", start: "2026-06-22T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "confirmed", cancelMoney: 5000, refundCutoff: null, extId: "evt-g" });

    const r = applyGmailCostEvidence(conn.db, id, { cancelMoney: 7000, refundCutoff: "2026-06-21" }, "2026-06-16T10:00:00.000Z");
    expect(r).toEqual({ updatedMoney: false, updatedCutoff: true });
    const row = getEvent(conn, id);
    expect(row.cancel_money).toBe(5000);
    expect(row.refund_cutoff).toBe("2026-06-21");
  });

  it("is idempotent on rerun with the same evidence", () => {
    const conn = makeTestDb();
    const id = insertEvent(conn, { title: "공연", start: "2026-06-20T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "planned", extId: "evt-a" });

    applyGmailCostEvidence(conn.db, id, { cancelMoney: 12000, refundCutoff: "2026-06-19" }, "2026-06-16T10:00:00.000Z");
    const second = applyGmailCostEvidence(conn.db, id, { cancelMoney: 12000, refundCutoff: "2026-06-19" }, "2026-06-17T10:00:00.000Z");
    expect(second).toEqual({ updatedMoney: false, updatedCutoff: false });
    const row = getEvent(conn, id);
    expect(row.cancel_money).toBe(12000);
    expect(row.refund_cutoff).toBe("2026-06-19");
    // updated_at stays at the first write — no second mutation
    expect(row.updated_at).toBe("2026-06-16T10:00:00.000Z");
  });

  it("does not change row counts of events/annotations/threads/tasks", () => {
    const conn = makeTestDb();
    const id = insertEvent(conn, { title: "공연", start: "2026-06-20T19:00:00+09:00", source: "gcal", selfImposed: 0, status: "planned", extId: "evt-a" });
    const before = {
      events: rowCount(conn, "events"),
      annotations: rowCount(conn, "annotations"),
      threads: rowCount(conn, "threads"),
      tasks: rowCount(conn, "tasks")
    };

    applyGmailCostEvidence(conn.db, id, { cancelMoney: 12000, refundCutoff: "2026-06-19" }, "2026-06-16T10:00:00.000Z");

    expect({
      events: rowCount(conn, "events"),
      annotations: rowCount(conn, "annotations"),
      threads: rowCount(conn, "threads"),
      tasks: rowCount(conn, "tasks")
    }).toEqual(before);
  });
});
