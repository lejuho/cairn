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
