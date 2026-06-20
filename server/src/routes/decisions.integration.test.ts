import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-dec-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const DATE = "2026-06-20";
const NOW = "2026-06-20T08:00:00+09:00";

function insertEvent(
  conn: SqliteConnection,
  start: string,
  end: string,
  status = "planned",
  opts: { cancelMoney?: number; cancelSocial?: number; cancelEffort?: string; reversible?: number } = {}
): number {
  const result = conn.sqlite
    .prepare(
      `INSERT INTO events (title, start, end, source, self_imposed, status,
        cancel_money, cancel_social, cancel_effort, reversible)
       VALUES ('E', ?, ?, 'cairn', 1, ?, ?, ?, ?, ?)`
    )
    .run(
      start, end, status,
      opts.cancelMoney ?? 0,
      opts.cancelSocial ?? 0,
      opts.cancelEffort ?? "none",
      opts.reversible ?? 1
    );
  return Number(result.lastInsertRowid);
}

function getConflicts(conn: SqliteConnection, now = NOW) {
  const app = buildServer(conn.db);
  return app.inject({
    method: "GET",
    url: `/api/decisions/conflicts?date=${DATE}&now=${encodeURIComponent(now)}`
  });
}

function resolve(conn: SqliteConnection, body: object) {
  const app = buildServer(conn.db);
  return app.inject({ method: "POST", url: "/api/decisions/conflicts/resolve", payload: body });
}

// ── GET /api/decisions/conflicts ──────────────────────────────────────────────

describe("GET /api/decisions/conflicts — basics", () => {
  it("returns empty list when no events", async () => {
    const conn = makeTestDb();
    const res = await getConflicts(conn);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.conflicts).toHaveLength(0);
  });

  it("returns empty list when no overlap", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    insertEvent(conn, "2026-06-20T12:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    expect(res.json().data.conflicts).toHaveLength(0);
  });

  it("detects overlap between two planned events", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    expect(res.json().data.conflicts).toHaveLength(1);
    expect(res.json().data.conflicts[0].overlapMinutes).toBeCloseTo(60, 5);
  });

  it("excludes non-planned/confirmed statuses", async () => {
    const conn = makeTestDb();
    for (const status of ["cancelled", "done", "moved", "late"]) {
      insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", status);
    }
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    expect(res.json().data.conflicts).toHaveLength(0);
  });

  it("returns 400 for missing date", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: `/api/decisions/conflicts?now=${encodeURIComponent(NOW)}`
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/decisions/conflicts — overlap math", () => {
  it("uses epoch ms for overlap, handles mixed offsets", async () => {
    const conn = makeTestDb();
    // A: 00:30-10:00 = 10:30Z, ends 02:30-10:00 = 12:30Z
    // B: 09:00+09:00 = 00:00Z, ends 12:00+09:00 = 03:00Z
    // No overlap: B ends at 03:00Z, A starts at 10:30Z
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('A', '2026-06-20T00:30:00-10:00', '2026-06-20T02:30:00-10:00', 'cairn', 1, 'planned')")
      .run();
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('B', '2026-06-20T09:00:00+09:00', '2026-06-20T12:00:00+09:00', 'cairn', 1, 'planned')")
      .run();
    const res = await getConflicts(conn, "2026-06-20T00:00:00+00:00");
    expect(res.json().data.conflicts).toHaveLength(0);
  });

  it("overlap minutes correct for overlapping mixed-offset events", async () => {
    const conn = makeTestDb();
    // A: 10:00+09:00 = 01:00Z to 13:00+09:00 = 04:00Z
    // B: 11:00+09:00 = 02:00Z to 14:00+09:00 = 05:00Z
    // Overlap: 02:00Z to 04:00Z = 2h = 120min
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('A', '2026-06-20T10:00:00+09:00', '2026-06-20T13:00:00+09:00', 'cairn', 1, 'planned')")
      .run();
    conn.sqlite
      .prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('B', '2026-06-20T11:00:00+09:00', '2026-06-20T14:00:00+09:00', 'cairn', 1, 'planned')")
      .run();
    const res = await getConflicts(conn);
    expect(res.json().data.conflicts).toHaveLength(1);
    expect(res.json().data.conflicts[0].overlapMinutes).toBeCloseTo(120, 5);
  });
});

describe("GET /api/decisions/conflicts — urgency and id", () => {
  it("near when either event starts within 6h of now", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T08:00:00+09:00"; // 8am KST
    // A starts at 10am KST = 2h ahead → near
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn, now);
    expect(res.json().data.conflicts[0].urgency).toBe("near");
  });

  it("planning when both events start more than 6h from now", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T01:00:00+09:00"; // 1am KST
    // A starts at 10am KST = 9h ahead → planning
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn, now);
    expect(res.json().data.conflicts[0].urgency).toBe("planning");
  });

  it("conflict id is stable sorted pair ids", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    const expected = [idA, idB].sort((a, b) => a - b).join(":");
    expect(res.json().data.conflicts[0].id).toBe(expected);
  });
});

describe("GET /api/decisions/conflicts — cost and suggestion", () => {
  it("exposes separate cost fields, no scalar total", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", {
      cancelMoney: 5000, cancelSocial: 2, cancelEffort: "high"
    });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    const opt = res.json().data.conflicts[0].options[0];
    expect(opt.cost).toHaveProperty("money");
    expect(opt.cost).toHaveProperty("social");
    expect(opt.cost).toHaveProperty("effort");
    expect(opt.cost).toHaveProperty("window");
    expect(opt.cost).not.toHaveProperty("total");
    expect(res.json().data.conflicts[0]).not.toHaveProperty("totalCost");
  });

  it("suggests the lower-cost option when costs differ", async () => {
    const conn = makeTestDb();
    // A: high cancel cost (money=10000, non-reversible) → suggest cancelling A only if cheaper
    // B: zero cost → lower cost → suggest B
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", {
      cancelMoney: 10000, cancelSocial: 3, reversible: 0
    });
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    const [optA, optB] = res.json().data.conflicts[0].options;
    // A has high cost → B (zero cost) is suggested
    const optForA = optA.event.id === idA ? optA : optB;
    const optForB = optA.event.id === idB ? optA : optB;
    expect(optForB.suggested).toBe(true);
    expect(optForA.suggested).toBe(false);
  });

  it("no suggestion when both sides have zero/unknown costs", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    const [optA, optB] = res.json().data.conflicts[0].options;
    expect(optA.suggested).toBe(false);
    expect(optB.suggested).toBe(false);
  });
});

// ── POST /api/decisions/conflicts/resolve ─────────────────────────────────────

describe("POST /api/decisions/conflicts/resolve — validation", () => {
  it("returns 400 for missing keepEventId", async () => {
    const conn = makeTestDb();
    const res = await resolve(conn, { changeEventId: 1, outcome: "moved" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid outcome", async () => {
    const conn = makeTestDb();
    const res = await resolve(conn, { keepEventId: 1, changeEventId: 2, outcome: "done" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/decisions/conflicts/resolve — behavior", () => {
  it("updates changeEvent status and inserts annotation", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now: "2026-06-20T08:00:00+09:00" });
    expect(res.statusCode).toBe(200);
    const { changedEvent, annotation } = res.json().data;
    expect(changedEvent.status).toBe("moved");
    expect(changedEvent.id).toBe(idB);
    expect(annotation.outcome).toBe("moved");
    expect(annotation.reasonTags).toContain("conflict_resolution");
    expect(annotation.reasonText).toBe("conflict_resolution");
  });

  it("includes user note in annotation when provided", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await resolve(conn, {
      keepEventId: idA, changeEventId: idB, outcome: "cancelled", note: "중요한 이유", now: "2026-06-20T08:00:00+09:00"
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.annotation.reasonText).toBe("중요한 이유");
  });

  it("returns 404 when either event does not exist", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: 9999, outcome: "moved" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 409 CONFLICT_STALE when events no longer overlap", async () => {
    const conn = makeTestDb();
    // Non-overlapping events
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T12:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT_STALE");
  });

  it("does not update status when stale check fires (no partial write)", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T11:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T12:00:00+09:00", "2026-06-20T13:00:00+09:00");
    await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved" });
    const row = conn.sqlite.prepare("SELECT status FROM events WHERE id = ?").get(idB) as { status: string };
    expect(row.status).toBe("planned");
  });

  // ISSUE-1: stale status check
  it("returns 409 CONFLICT_STALE when changeEvent already moved/cancelled", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00", "moved");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT_STALE");
  });

  it("returns 409 CONFLICT_STALE when keepEvent already cancelled", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "cancelled");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT_STALE");
  });

  // ISSUE-2: same event id rejected
  it("returns 400 when keepEventId and changeEventId are the same", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idA, outcome: "moved" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

// ISSUE-3: reversible-only must not trigger suggestion
describe("GET /api/decisions/conflicts — reversible-only no suggestion", () => {
  it("no suggestion when cost fields are all zero/none and only reversible differs", async () => {
    const conn = makeTestDb();
    // A: non-reversible (reversible=0), zero costs
    conn.sqlite
      .prepare(
        `INSERT INTO events (title, start, end, source, self_imposed, status,
          cancel_money, cancel_social, cancel_effort, reversible)
         VALUES ('A', '2026-06-20T10:00:00+09:00', '2026-06-20T12:00:00+09:00',
           'cairn', 1, 'planned', 0, 0, 'none', 0)`
      )
      .run();
    // B: reversible (reversible=1), zero costs
    conn.sqlite
      .prepare(
        `INSERT INTO events (title, start, end, source, self_imposed, status,
          cancel_money, cancel_social, cancel_effort, reversible)
         VALUES ('B', '2026-06-20T11:00:00+09:00', '2026-06-20T13:00:00+09:00',
           'cairn', 1, 'planned', 0, 0, 'none', 1)`
      )
      .run();
    const res = await getConflicts(conn);
    expect(res.statusCode).toBe(200);
    const [optA, optB] = res.json().data.conflicts[0].options;
    expect(optA.suggested).toBe(false);
    expect(optB.suggested).toBe(false);
  });
});

// ── cycle-19: actionability ───────────────────────────────────────────────────

describe("GET /api/decisions/conflicts — actionability", () => {
  it("conflict starting in 2h is resolvable", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T08:00:00+09:00"; // 8am KST
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn, now);
    expect(res.json().data.conflicts[0].actionability).toBe("resolvable");
    expect(res.json().data.conflicts[0].disabledReasonCodes).toHaveLength(0);
  });

  it("conflict starting in 8h is read_only", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T02:00:00+09:00"; // 2am KST; events start at 10am = 8h away
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn, now);
    expect(res.json().data.conflicts[0].actionability).toBe("read_only");
    expect(res.json().data.conflicts[0].disabledReasonCodes).toContain("far_future");
  });

  it("past-start conflict is read_only with past_start code", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T11:30:00+09:00"; // both already started
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn, now);
    expect(res.json().data.conflicts[0].actionability).toBe("read_only");
    expect(res.json().data.conflicts[0].disabledReasonCodes).toContain("past_start");
  });

  it("read_only conflict still exposes overlap, cost chips, and no scalar total", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T02:00:00+09:00"; // far future
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelMoney: 3000 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn, now);
    const conflict = res.json().data.conflicts[0];
    expect(conflict.overlapMinutes).toBeGreaterThan(0);
    expect(conflict.options[0].cost).toHaveProperty("money");
    expect(conflict).not.toHaveProperty("totalCost");
  });
});

describe("POST /api/decisions/conflicts/resolve — actionability gating", () => {
  it("resolves a resolvable conflict (now within 6h of event start)", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T08:00:00+09:00"; // 2h before events
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.changedEvent.status).toBe("moved");
  });

  it("returns 409 CONFLICT_NOT_ACTIONABLE for far-future conflict", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T02:00:00+09:00"; // 8h before events
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT_NOT_ACTIONABLE");
  });

  it("returns 409 CONFLICT_NOT_ACTIONABLE for past-start conflict", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T12:00:00+09:00"; // both already started
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T14:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T15:00:00+09:00");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled", now });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT_NOT_ACTIONABLE");
  });

  it("not-actionable resolve has no partial event or annotation write", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T02:00:00+09:00";
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now });
    const row = conn.sqlite.prepare("SELECT status FROM events WHERE id = ?").get(idB) as { status: string };
    expect(row.status).toBe("planned");
    const ann = conn.sqlite.prepare("SELECT id FROM annotations WHERE event_id = ?").all(idB);
    expect(ann).toHaveLength(0);
  });

  it("existing CONFLICT_STALE checks still pass after actionability addition", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T08:00:00+09:00";
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00", "moved");
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled", now });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT_STALE");
  });
});

// ── helpers for people guard tests ───────────────────────────────────────────

function insertPerson(conn: SqliteConnection, name: string, hardConstraintsJson?: string): number {
  conn.sqlite.prepare("INSERT INTO people (name, channel, hard_constraints) VALUES (?, 'none', ?)").run(name, hardConstraintsJson ?? null);
  const row = conn.sqlite.prepare("SELECT id FROM people WHERE name = ? ORDER BY id DESC LIMIT 1").get(name) as { id: number };
  return row.id;
}

function linkPersonToEvent(conn: SqliteConnection, eventId: number, personId: number): void {
  conn.sqlite.prepare("INSERT OR IGNORE INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, personId);
}

function insertPastEvent(conn: SqliteConnection, personId: number, end: string, status = "done"): void {
  const result = conn.sqlite.prepare(
    "INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('past', '2026-01-01T10:00:00+09:00', ?, 'cairn', 1, ?)"
  ).run(end, status);
  const eventId = Number((result as { lastInsertRowid: number }).lastInsertRowid);
  conn.sqlite.prepare("INSERT OR IGNORE INTO event_people (event_id, person_id) VALUES (?, ?)").run(eventId, personId);
}

// 2026-06-20 is a Saturday
const SAT_CONSTRAINT = JSON.stringify([{ type: "weekday_unavailable", weekday: "saturday", text: "saturday 불가", firmness: "hard" }]);
const FRI_CONSTRAINT = JSON.stringify([{ type: "weekday_unavailable", weekday: "friday", text: "friday 불가", firmness: "hard" }]);

// ── GET /api/decisions/conflicts — social context ─────────────────────────────

describe("GET /api/decisions/conflicts — social context", () => {
  it("no people: socialContext.confidence is none, effective equals stored social", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelSocial: 3 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    // Option for the event with cancelSocial=3
    const withSocial = opts.find((o: { socialContext: { base: number } }) => o.socialContext.base === 3);
    expect(withSocial.socialContext.confidence).toBe("none");
    expect(withSocial.socialContext.effective).toBe(3);
    expect(withSocial.socialContext.adjustment).toBeNull();
    expect(withSocial.cost.social).toBe(3);
  });

  it("cold_start person (0 meets): confidence cold_start, no adjustment to effective", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelSocial: 2 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "TestPerson");
    linkPersonToEvent(conn, idA, pid);
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    const optA = opts.find((o: { event: { id: number } }) => o.event.id === idA);
    expect(optA.socialContext.confidence).toBe("cold_start");
    expect(optA.socialContext.contributions[0].frequencyBand).toBe("cold_start");
    expect(optA.socialContext.contributions[0].adjustment).toBe(0);
    expect(optA.socialContext.effective).toBe(2); // base + 0 adjustment
  });

  it("rare person (1-2 meets): +2 adjustment", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelSocial: 1 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "RarePerson");
    linkPersonToEvent(conn, idA, pid);
    insertPastEvent(conn, pid, "2026-05-01T11:00:00+09:00", "done"); // 1 qualifying meet
    const res = await getConflicts(conn, "2026-06-20T09:00:00+09:00");
    const opts = res.json().data.conflicts[0].options;
    const optA = opts.find((o: { event: { id: number } }) => o.event.id === idA);
    expect(optA.socialContext.contributions[0].frequencyBand).toBe("rare");
    expect(optA.socialContext.contributions[0].adjustment).toBe(2);
    expect(optA.socialContext.effective).toBe(3); // 1 + 2
    expect(optA.cost.social).toBe(3);
  });

  it("established person (3-7 meets): +1 adjustment; frequent (8+): +0", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelSocial: 2 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const estPid = insertPerson(conn, "EstPerson");
    const freqPid = insertPerson(conn, "FreqPerson");
    linkPersonToEvent(conn, idA, estPid);
    linkPersonToEvent(conn, idA, freqPid);
    for (let i = 0; i < 3; i++) insertPastEvent(conn, estPid, `2026-0${i + 1}-01T11:00:00+09:00`, "done");
    for (let i = 0; i < 8; i++) insertPastEvent(conn, freqPid, `2025-0${i + 1}-01T11:00:00+09:00`, "done");
    const res = await getConflicts(conn, "2026-06-20T09:00:00+09:00");
    const opts = res.json().data.conflicts[0].options;
    const optA = opts.find((o: { event: { id: number } }) => o.event.id === idA);
    const est = optA.socialContext.contributions.find((c: { personName: string }) => c.personName === "EstPerson");
    const freq = optA.socialContext.contributions.find((c: { personName: string }) => c.personName === "FreqPerson");
    expect(est.frequencyBand).toBe("established");
    expect(freq.frequencyBand).toBe("frequent");
    expect(optA.socialContext.effective).toBe(3); // 2 + 1 + 0
  });

  it("boundary 2 meets: still rare (+2)", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelSocial: 1 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "Rare2Person");
    linkPersonToEvent(conn, idA, pid);
    insertPastEvent(conn, pid, "2026-04-01T11:00:00+09:00", "done");
    insertPastEvent(conn, pid, "2026-05-01T11:00:00+09:00", "done"); // exactly 2 meets → rare
    const res = await getConflicts(conn, "2026-06-20T09:00:00+09:00");
    const opts = res.json().data.conflicts[0].options;
    const optA = opts.find((o: { event: { id: number } }) => o.event.id === idA);
    const contrib = optA.socialContext.contributions[0];
    expect(contrib.totalMeets).toBe(2);
    expect(contrib.frequencyBand).toBe("rare");
    expect(contrib.adjustment).toBe(2);
  });

  it("boundary 7 meets: still established (+1)", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelSocial: 2 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "Est7Person");
    linkPersonToEvent(conn, idA, pid);
    for (let i = 0; i < 7; i++) insertPastEvent(conn, pid, `2025-0${i + 1}-01T11:00:00+09:00`, "done"); // exactly 7 → established
    const res = await getConflicts(conn, "2026-06-20T09:00:00+09:00");
    const opts = res.json().data.conflicts[0].options;
    const optA = opts.find((o: { event: { id: number } }) => o.event.id === idA);
    const contrib = optA.socialContext.contributions[0];
    expect(contrib.totalMeets).toBe(7);
    expect(contrib.frequencyBand).toBe("established");
    expect(contrib.adjustment).toBe(1);
  });

  it("mixed-offset: +09:00 event past by epoch but lexically > Z nowIso is counted; lastMet is epoch-latest", async () => {
    // Bug scenario: lexical `r.end < nowIso` misclassifies cross-offset timestamps.
    // now = "2026-06-20T00:30:00Z" (UTC midnight+30min)
    // Past event A: "2026-06-20T09:00:00+09:00" = "2026-06-20T00:00:00Z" — IS past (30min before now)
    //   but lexically "2026-06-20T09:00:00+09:00" > "2026-06-20T00:30:00Z" → old code WRONGLY excludes
    // Past event B: "2026-05-10T01:00:00+09:00" = "2026-05-09T16:00:00Z" — past both ways
    //   but lexically "2026-05-10..." > "2026-05-09T20:00:00Z" → old lastMet picks this WRONGLY
    // Past event C: "2026-05-09T20:00:00Z" = epoch-latest of B and C
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelSocial: 1 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "MixedPerson");
    linkPersonToEvent(conn, idA, pid);
    // A: past by epoch, lexically > Z nowIso — old filter bug excludes this
    insertPastEvent(conn, pid, "2026-06-20T09:00:00+09:00", "done");
    // B: epoch = May 9 16:00Z; lexically "2026-05-10..." beats C but epoch-wise is earlier
    insertPastEvent(conn, pid, "2026-05-10T01:00:00+09:00", "done");
    // C: epoch = May 9 20:00Z — epoch-later than B; lexically "2026-05-09..." loses to B
    insertPastEvent(conn, pid, "2026-05-09T20:00:00Z", "done");
    const res = await getConflicts(conn, "2026-06-20T00:30:00Z");
    const opts = res.json().data.conflicts[0].options;
    const optA = opts.find((o: { event: { id: number } }) => o.event.id === idA);
    const contrib = optA.socialContext.contributions[0];
    // Old lexical code: totalMeets=2 (A excluded), lastMet="2026-05-10T01:00:00+09:00" (lexically max of B,C)
    // New epoch code: totalMeets=3 (A included), lastMet="2026-06-20T09:00:00+09:00" (epoch-latest)
    expect(contrib.totalMeets).toBe(3);
    expect(contrib.lastMet).toBe("2026-06-20T09:00:00+09:00");
  });

  it("excludes future, planned, cancelled, moved, late events from meeting stats", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelSocial: 1 });
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "ExcludedPerson");
    linkPersonToEvent(conn, idA, pid);
    insertPastEvent(conn, pid, "2026-05-01T11:00:00+09:00", "planned");   // planned → excluded
    insertPastEvent(conn, pid, "2026-05-02T11:00:00+09:00", "cancelled"); // cancelled → excluded
    insertPastEvent(conn, pid, "2026-05-03T11:00:00+09:00", "moved");     // moved → excluded
    insertPastEvent(conn, pid, "2026-05-04T11:00:00+09:00", "late");      // late → excluded
    // future event with done status but end in future → excluded
    conn.sqlite.prepare("INSERT INTO events (title, start, end, source, self_imposed, status) VALUES ('fut', '2026-12-01T10:00:00+09:00', '2026-12-01T11:00:00+09:00', 'cairn', 1, 'done')").run();
    const futId = conn.sqlite.prepare("SELECT id FROM events WHERE title = 'fut'").get() as { id: number };
    conn.sqlite.prepare("INSERT OR IGNORE INTO event_people (event_id, person_id) VALUES (?, ?)").run(futId.id, pid);
    const res = await getConflicts(conn, "2026-06-20T09:00:00+09:00");
    const opts = res.json().data.conflicts[0].options;
    const optA = opts.find((o: { event: { id: number } }) => o.event.id === idA);
    expect(optA.socialContext.confidence).toBe("cold_start"); // 0 qualifying meets
  });
});

// ── GET /api/decisions/conflicts — people guard ───────────────────────────────

describe("GET /api/decisions/conflicts — people guard", () => {
  it("no people: peopleGuard.blocked is false for both options", async () => {
    const conn = makeTestDb();
    insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    expect(opts[0].peopleGuard.blocked).toBe(false);
    expect(opts[1].peopleGuard.blocked).toBe(false);
  });

  it("saturday constraint blocks option that keeps the saturday event", async () => {
    const conn = makeTestDb();
    // 2026-06-20 = Saturday; event A starts on Saturday
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "NoPerson", SAT_CONSTRAINT);
    linkPersonToEvent(conn, idA, pid); // person linked to A
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    // Option to cancel B (keep A) → guard checks A's people → A has sat constraint → blocked
    const optCancelB = opts.find((o: { event: { id: number } }) => o.event.id === idB);
    expect(optCancelB.peopleGuard.blocked).toBe(true);
    expect(optCancelB.peopleGuard.keepEventId).toBe(idA);
    expect(optCancelB.peopleGuard.reasonCodes).toContain("weekday_unavailable");
    // Option to cancel A → guard checks B's people → B has no people → not blocked
    const optCancelA = opts.find((o: { event: { id: number } }) => o.event.id === idA);
    expect(optCancelA.peopleGuard.blocked).toBe(false);
  });

  it("non-matching weekday constraint does not block", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "FridayPerson", FRI_CONSTRAINT); // friday constraint but event is saturday
    linkPersonToEvent(conn, idA, pid);
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    expect(opts.every((o: { peopleGuard: { blocked: boolean } }) => !o.peopleGuard.blocked)).toBe(true);
  });

  it("malformed hard_constraints JSON fails open — does not block", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "MalformedPerson");
    conn.sqlite.prepare("UPDATE people SET hard_constraints = ? WHERE id = ?").run("not valid json{{{", pid);
    linkPersonToEvent(conn, idA, pid);
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    expect(opts.every((o: { peopleGuard: { blocked: boolean } }) => !o.peopleGuard.blocked)).toBe(true);
  });

  it("blocked option is not suggested even when it has lower cost", async () => {
    const conn = makeTestDb();
    // A has very low cost, but person A is linked to A with saturday constraint
    // Option to cancel B (keep A) → blocked → must NOT be suggested
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00", "planned", { cancelMoney: 0, cancelSocial: 0 });
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00", "planned", { cancelMoney: 100, cancelSocial: 3 });
    const pid = insertPerson(conn, "BlockedPerson", SAT_CONSTRAINT);
    linkPersonToEvent(conn, idA, pid);
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    const optCancelB = opts.find((o: { event: { id: number } }) => o.event.id === idB);
    expect(optCancelB.peopleGuard.blocked).toBe(true);
    expect(optCancelB.suggested).toBe(false);
  });

  it("one-side-blocked sets required_by_people_constraint on the allowed side", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "PeoplePerson", SAT_CONSTRAINT);
    linkPersonToEvent(conn, idA, pid);
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    const optCancelA = opts.find((o: { event: { id: number } }) => o.event.id === idA); // unblocked side
    expect(optCancelA.reasonCodes).toContain("required_by_people_constraint");
  });

  it("same person linked to both events: each guard evaluates independently", async () => {
    const conn = makeTestDb();
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "BothPerson", SAT_CONSTRAINT);
    linkPersonToEvent(conn, idA, pid);
    linkPersonToEvent(conn, idB, pid);
    const res = await getConflicts(conn);
    const opts = res.json().data.conflicts[0].options;
    // Both events are on Saturday and person is linked to both → both options blocked
    expect(opts[0].peopleGuard.blocked).toBe(true);
    expect(opts[1].peopleGuard.blocked).toBe(true);
  });
});

// ── POST /api/decisions/conflicts/resolve — people guard ─────────────────────

describe("POST /api/decisions/conflicts/resolve — people guard", () => {
  it("rejects blocked option with 409 PEOPLE_CONSTRAINT_BLOCKED", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T08:00:00+09:00";
    // Keep A (saturday), change B — A has person with saturday constraint
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "GuardPerson", SAT_CONSTRAINT);
    linkPersonToEvent(conn, idA, pid);
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled", now });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("PEOPLE_CONSTRAINT_BLOCKED");
  });

  it("blocked resolve performs no event or annotation write", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T08:00:00+09:00";
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "GuardPerson2", SAT_CONSTRAINT);
    linkPersonToEvent(conn, idA, pid);
    await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled", now });
    const bRow = conn.sqlite.prepare("SELECT status FROM events WHERE id = ?").get(idB) as { status: string };
    expect(bRow.status).toBe("planned");
    const anns = conn.sqlite.prepare("SELECT id FROM annotations WHERE event_id = ?").all(idB);
    expect(anns).toHaveLength(0);
  });

  it("unblocked option (cancel A, keep B which has no constraint) still resolves", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T08:00:00+09:00";
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "GuardPerson3", SAT_CONSTRAINT);
    linkPersonToEvent(conn, idA, pid); // constraint on A's people
    // Cancel A (keepEventId = B, changeEventId = A) — B has no constraint → allowed
    const res = await resolve(conn, { keepEventId: idB, changeEventId: idA, outcome: "cancelled", now });
    expect(res.statusCode).toBe(200);
    const aRow = conn.sqlite.prepare("SELECT status FROM events WHERE id = ?").get(idA) as { status: string };
    expect(aRow.status).toBe("cancelled");
  });

  it("soft/unsupported constraint in JSON does not block resolve", async () => {
    const conn = makeTestDb();
    const now = "2026-06-20T08:00:00+09:00";
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    const pid = insertPerson(conn, "SoftPerson");
    // soft firmness — not enforceable
    conn.sqlite.prepare("UPDATE people SET hard_constraints = ? WHERE id = ?")
      .run(JSON.stringify([{ type: "weekday_unavailable", weekday: "saturday", text: "soft", firmness: "soft" }]), pid);
    linkPersonToEvent(conn, idA, pid);
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled", now });
    expect(res.statusCode).toBe(200);
  });
});

// ── POST resolve — notification drafts ───────────────────────────────────────

describe("POST /api/decisions/conflicts/resolve — notification drafts", () => {
  const now = "2026-06-20T08:00:00+09:00";

  function makeOverlap(conn: SqliteConnection) {
    const idA = insertEvent(conn, "2026-06-20T10:00:00+09:00", "2026-06-20T12:00:00+09:00");
    const idB = insertEvent(conn, "2026-06-20T11:00:00+09:00", "2026-06-20T13:00:00+09:00");
    return { idA, idB };
  }

  it("no people attached returns empty notificationDrafts", async () => {
    const conn = makeTestDb();
    const { idA, idB } = makeOverlap(conn);
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.notificationDrafts).toEqual([]);
  });

  it("person attached to changeEventId only produces one draft", async () => {
    const conn = makeTestDb();
    const { idA, idB } = makeOverlap(conn);
    const pid = insertPerson(conn, "민지");
    conn.sqlite.prepare("UPDATE people SET channel = ? WHERE id = ?").run("kakao", pid);
    // leadTime=0 → always enough regardless of event start
    conn.sqlite.prepare("UPDATE people SET lead_time = ? WHERE id = ?")
      .run(JSON.stringify({ days: 0, firmness: "hard" }), pid);
    linkPersonToEvent(conn, idB, pid); // only changeEvent
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now });
    expect(res.statusCode).toBe(200);
    const { notificationDrafts } = res.json().data;
    expect(notificationDrafts).toHaveLength(1);
    expect(notificationDrafts[0].personName).toBe("민지");
    expect(notificationDrafts[0].channel).toBe("kakao");
    expect(notificationDrafts[0].leadTimeDays).toBe(0);
    expect(notificationDrafts[0].leadTimeStatus).toBe("enough");
    expect(notificationDrafts[0].tone).toBe("neutral");
    expect(notificationDrafts[0].message).toContain("민지님");
  });

  it("person attached to keepEventId only produces no draft", async () => {
    const conn = makeTestDb();
    const { idA, idB } = makeOverlap(conn);
    const pid = insertPerson(conn, "지수");
    linkPersonToEvent(conn, idA, pid); // only keepEvent
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled", now });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.notificationDrafts).toEqual([]);
  });

  it("multiple people produce drafts in name-asc, id-asc order", async () => {
    const conn = makeTestDb();
    const { idA, idB } = makeOverlap(conn);
    const p1 = insertPerson(conn, "지수");
    const p2 = insertPerson(conn, "민지");
    linkPersonToEvent(conn, idB, p1);
    linkPersonToEvent(conn, idB, p2);
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.notificationDrafts.map((d: { personName: string }) => d.personName);
    expect(names).toEqual(["민지", "지수"]); // alphabetical
  });

  it("person on both events produces one draft (changeEventId is the source)", async () => {
    const conn = makeTestDb();
    const { idA, idB } = makeOverlap(conn);
    const pid = insertPerson(conn, "공통");
    linkPersonToEvent(conn, idA, pid);
    linkPersonToEvent(conn, idB, pid);
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled", now });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.notificationDrafts).toHaveLength(1);
  });

  it("malformed lead_time JSON stays unknown (fail-open)", async () => {
    const conn = makeTestDb();
    const { idA, idB } = makeOverlap(conn);
    const pid = insertPerson(conn, "망가진프로필");
    conn.sqlite.prepare("UPDATE people SET lead_time = ? WHERE id = ?").run("NOT-JSON{{", pid);
    linkPersonToEvent(conn, idB, pid);
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now });
    expect(res.statusCode).toBe(200);
    const draft = res.json().data.notificationDrafts[0];
    expect(draft.leadTimeStatus).toBe("unknown");
    expect(draft.leadTimeDays).toBeNull();
  });

  it("resolution still writes exactly one event update and annotation", async () => {
    const conn = makeTestDb();
    const { idA, idB } = makeOverlap(conn);
    const pid = insertPerson(conn, "수지");
    linkPersonToEvent(conn, idB, pid);
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "cancelled", now });
    expect(res.statusCode).toBe(200);
    const evRow = conn.sqlite.prepare("SELECT status FROM events WHERE id = ?").get(idB) as { status: string };
    expect(evRow.status).toBe("cancelled");
    const annRow = conn.sqlite.prepare("SELECT count(*) as cnt FROM annotations WHERE event_id = ?").get(idB) as { cnt: number };
    expect(annRow.cnt).toBe(1);
  });

  it("failed resolve (stale) produces no drafts and no event/annotation write", async () => {
    const conn = makeTestDb();
    const { idA, idB } = makeOverlap(conn);
    // Make stale: set idB to cancelled
    conn.sqlite.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(idB);
    const pid = insertPerson(conn, "누군가");
    linkPersonToEvent(conn, idB, pid);
    const res = await resolve(conn, { keepEventId: idA, changeEventId: idB, outcome: "moved", now });
    expect(res.statusCode).toBe(409);
    expect(res.json().ok).toBe(false);
    const annRow = conn.sqlite.prepare("SELECT count(*) as cnt FROM annotations WHERE event_id = ?").get(idB) as { cnt: number };
    expect(annRow.cnt).toBe(0);
  });
});
