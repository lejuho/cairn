import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";
import { createReversePlanWatcher } from "../repositories/watchers.js";
import { findWatchersForPush } from "../repositories/watchers.js";
import { selectDueForPush } from "../services/watcher-daily-push.js";

const DATE = "2026-07-10";
const NOW = "2026-07-10T00:00:00+00:00";
const ENC_NOW = encodeURIComponent(NOW);

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-rp-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const BASE_RP_INPUT = {
  label: "여권 갱신",
  category: "travel",
  targetDate: "2026-07-30",
  safetyDays: 3 as const,
  steps: [
    { label: "여권 신청", leadDays: 21 },
    { label: "항공권 확인", leadDays: 2 }
  ]
};

describe("createReversePlanWatcher — atomic transaction", () => {
  it("inserts watcher + step tasks + links in one transaction", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    expect(result.watcher.id).toBeGreaterThan(0);
    expect(result.watcher.kind).toBe("A");
    expect(result.watcher.armed).toBe(1);

    // step tasks returned with full row data
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]!.id).toBeGreaterThan(0);
    expect(result.tasks[0]!.title).toBe("여권 신청");
    expect(result.tasks[0]!.status).toBe("todo");

    // target task is separate
    expect(result.targetTask.id).toBeGreaterThan(0);
    expect(result.targetTask.title).toBe(BASE_RP_INPUT.label); // targetLabel defaults to label

    // links: N-1 step-step + 1 target-lastStep = 2 for 2 steps
    expect(result.links).toHaveLength(2);

    // verify link direction: targetTask requires lastStepTask
    const lastStepId = result.tasks[result.tasks.length - 1]!.id;
    const targetLink = conn.sqlite
      .prepare("SELECT * FROM links WHERE from_id=? AND to_id=? AND kind='requires'")
      .get(result.targetTask.id, lastStepId);
    expect(targetLink).toBeTruthy();

    // verify step1 requires step0
    const stepLink = conn.sqlite
      .prepare("SELECT * FROM links WHERE from_id=? AND to_id=? AND kind='requires'")
      .get(result.tasks[1]!.id, result.tasks[0]!.id);
    expect(stepLink).toBeTruthy();
  });

  it("stored rule has type=reverse_plan and taskIds", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    const rule = JSON.parse(result.watcher.rule ?? "{}") as Record<string, unknown>;
    expect(rule.type).toBe("reverse_plan");
    expect(rule.targetTaskId).toBe(result.targetTask.id);
    const steps = rule.steps as Array<{ taskId: number }>;
    expect(steps[0]!.taskId).toBe(result.tasks[0]!.id);
  });

  it("threshold is first step's latestDate", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    // safetyDays=3, steps[0].leadDays=21, steps[1].leadDays=2
    // step1: 2026-07-30 - 2 = 2026-07-28
    // step0: 2026-07-28 - 21 - 3 = 2026-07-04
    expect(result.watcher.threshold).toBe("2026-07-04");
  });

  it("links have firmness=hard and source=authored", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    const link = conn.sqlite
      .prepare("SELECT firmness, source FROM links WHERE id=?")
      .get(result.links[0]!.id) as { firmness: string; source: string };
    expect(link.firmness).toBe("hard");
    expect(link.source).toBe("authored");
  });

  it("reversePlan view in result has all steps todo and nextStepIndex=0", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    expect(result.reversePlan.nextStepIndex).toBe(0);
    expect(result.reversePlan.completed).toBe(false);
    expect(result.reversePlan.steps[0]!.taskStatus).toBe("todo");
  });

  it("rejects invalid targetDate — computeReversePlan throws", () => {
    const conn = makeTestDb();
    expect(() =>
      createReversePlanWatcher(conn.db, {
        ...BASE_RP_INPUT,
        targetDate: "2026-02-30"
      })
    ).toThrow();
  });

  it("rolls back watcher and task rows when link insert fails", () => {
    const conn = makeTestDb();
    // Force all link inserts to fail via a BEFORE INSERT trigger
    conn.sqlite
      .prepare(
        "CREATE TRIGGER force_link_fail BEFORE INSERT ON links BEGIN " +
        "SELECT RAISE(ABORT, 'forced link failure'); END;"
      )
      .run();

    expect(() => createReversePlanWatcher(conn.db, BASE_RP_INPUT)).toThrow("forced link failure");

    // Transaction must have rolled back — no orphaned rows
    const taskCount = (conn.sqlite.prepare("SELECT COUNT(*) as cnt FROM tasks").get() as { cnt: number }).cnt;
    const watcherCount = (conn.sqlite.prepare("SELECT COUNT(*) as cnt FROM watchers").get() as { cnt: number }).cnt;
    expect(taskCount).toBe(0);
    expect(watcherCount).toBe(0);

    conn.sqlite.prepare("DROP TRIGGER IF EXISTS force_link_fail").run();
  });
});

describe("GET /api/watchers — reverse-plan deep view", () => {
  it("returns reversePlan field for reverse-plan watcher", async () => {
    const conn = makeTestDb();
    createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/watchers?date=${DATE}&now=${ENC_NOW}`
    });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.payload) as { ok: boolean; data: { watchers: Array<{ reversePlan?: unknown }> } };
    const [w] = body.data.watchers;
    expect(w!.reversePlan).toBeDefined();
    const rp = w!.reversePlan as { steps: Array<{ taskStatus: string }>; nextStepIndex: number };
    expect(rp.steps).toHaveLength(2);
    expect(rp.nextStepIndex).toBe(0);
  });

  it("shows due status when threshold reached (date >= threshold)", async () => {
    const conn = makeTestDb();
    // threshold will be 2026-07-04; DATE=2026-07-10 → due
    createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/watchers?date=${DATE}&now=${ENC_NOW}`
    });
    const body = JSON.parse(resp.payload) as { data: { watchers: Array<{ status: string }> } };
    expect(body.data.watchers[0]!.status).toBe("due");
  });

  it("shows quiet status when threshold is in the future", async () => {
    const conn = makeTestDb();
    createReversePlanWatcher(conn.db, { ...BASE_RP_INPUT, targetDate: "2026-12-31" });

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/watchers?date=${DATE}&now=${ENC_NOW}`
    });
    const body = JSON.parse(resp.payload) as { data: { watchers: Array<{ status: string }> } };
    expect(body.data.watchers[0]!.status).toBe("quiet");
  });

  it("shows quiet/completed when all steps done", async () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    for (const task of result.tasks) {
      conn.sqlite.prepare("UPDATE tasks SET status='done' WHERE id=?").run(task.id);
    }

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/watchers?date=${DATE}&now=${ENC_NOW}`
    });
    const body = JSON.parse(resp.payload) as { data: { watchers: Array<{ status: string; reversePlan?: { completed: boolean } }> } };
    expect(body.data.watchers[0]!.status).toBe("quiet");
    expect(body.data.watchers[0]!.reversePlan?.completed).toBe(true);
  });

  it("disarmed watcher shows disarmed status", async () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    conn.sqlite.prepare("UPDATE watchers SET armed=0 WHERE id=?").run(result.watcher.id);

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/watchers?date=${DATE}&now=${ENC_NOW}`
    });
    const body = JSON.parse(resp.payload) as { data: { watchers: Array<{ status: string }> } };
    expect(body.data.watchers[0]!.status).toBe("disarmed");
  });
});

describe("POST /api/watchers/reverse-plan — route", () => {
  it("creates watcher and returns { watcher, tasks, targetTask, links, reversePlan }", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "POST",
      url: "/api/watchers/reverse-plan",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify(BASE_RP_INPUT)
    });
    expect(resp.statusCode).toBe(201);
    const body = JSON.parse(resp.payload) as {
      ok: boolean;
      data: {
        watcher: { id: number };
        tasks: Array<{ id: number; title: string | null; status: string | null }>;
        targetTask: { id: number; title: string | null };
        links: Array<{ id: number }>;
        reversePlan: { nextStepIndex: number; completed: boolean; steps: Array<{ taskStatus: string }> };
      }
    };
    expect(body.ok).toBe(true);
    expect(body.data.watcher.id).toBeGreaterThan(0);
    expect(body.data.tasks).toHaveLength(2);
    expect(body.data.tasks[0]!.title).toBe("여권 신청");
    expect(body.data.tasks[0]!.status).toBe("todo");
    expect(body.data.targetTask.id).toBeGreaterThan(0);
    expect(body.data.links).toHaveLength(2);
    expect(body.data.reversePlan.nextStepIndex).toBe(0);
    expect(body.data.reversePlan.completed).toBe(false);
  });

  it("returns 400 VALIDATION_ERROR for overflow targetDate", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "POST",
      url: "/api/watchers/reverse-plan",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify({ ...BASE_RP_INPUT, targetDate: "2026-02-30" })
    });
    expect(resp.statusCode).toBe(400);
    const body = JSON.parse(resp.payload) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for non-date targetDate format", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "POST",
      url: "/api/watchers/reverse-plan",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify({ ...BASE_RP_INPUT, targetDate: "not-a-date" })
    });
    expect(resp.statusCode).toBe(400);
  });

  it("returns 400 VALIDATION_ERROR for unknown injected fields (strict)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "POST",
      url: "/api/watchers/reverse-plan",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify({ ...BASE_RP_INPUT, score: 0.9, recommendation: "act" })
    });
    expect(resp.statusCode).toBe(400);
    const body = JSON.parse(resp.payload) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when steps array is empty", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "POST",
      url: "/api/watchers/reverse-plan",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify({ ...BASE_RP_INPUT, steps: [] })
    });
    expect(resp.statusCode).toBe(400);
  });
});

describe("GET /api/today — reverse-plan watcher surfaces when due", () => {
  it("shows bubble when threshold reached and not snoozed", async () => {
    const conn = makeTestDb();
    // threshold=2026-07-04; DATE=2026-07-10 → due
    createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${ENC_NOW}`
    });
    const body = JSON.parse(resp.payload) as { data: { watcherBubbles: Array<{ id: number; message: string; reasonCodes: string[] }> } };
    expect(body.data.watcherBubbles.length).toBeGreaterThan(0);
    // ISSUE-2: message must be reverse-plan descriptive
    expect(body.data.watcherBubbles[0]!.message).toContain("여권 신청");
    expect(body.data.watcherBubbles[0]!.reasonCodes).toContain("reverse_plan_due");
  });

  it("does not show bubble when disarmed", async () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    conn.sqlite.prepare("UPDATE watchers SET armed=0 WHERE id=?").run(result.watcher.id);

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${ENC_NOW}`
    });
    const body = JSON.parse(resp.payload) as { data: { watcherBubbles: Array<unknown> } };
    expect(body.data.watcherBubbles).toHaveLength(0);
  });

  it("does not show bubble when all steps completed", async () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    for (const task of result.tasks) {
      conn.sqlite.prepare("UPDATE tasks SET status='done' WHERE id=?").run(task.id);
    }

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${ENC_NOW}`
    });
    const body = JSON.parse(resp.payload) as { data: { watcherBubbles: Array<unknown> } };
    expect(body.data.watcherBubbles).toHaveLength(0);
  });

  it("does not show bubble when snoozed (snoozedUntil in the future)", async () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    // threshold=2026-07-04, DATE=2026-07-10 → would be due; but snooze it
    const futureSnoozed = "2026-07-20T00:00:00+00:00";
    conn.sqlite
      .prepare("UPDATE watchers SET snoozed_until=? WHERE id=?")
      .run(futureSnoozed, result.watcher.id);

    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "GET",
      url: `/api/today?date=${DATE}&now=${ENC_NOW}`
    });
    const body = JSON.parse(resp.payload) as { data: { watcherBubbles: Array<unknown> } };
    expect(body.data.watcherBubbles).toHaveLength(0);
  });
});

describe("selectDueForPush — reverse-plan watcher", () => {
  it("includes due reverse-plan watcher in push digest with next step label", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    const statuses = new Map<number, string>(result.tasks.map((t) => [t.id, "todo"]));

    const rows = findWatchersForPush(conn.db);
    const { items, message } = selectDueForPush(rows, DATE, NOW, statuses);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.id).toBe(result.watcher.id);
    // ISSUE-2: push digest must include next step label
    expect(items[0]!.nextStepLabel).toBe("여권 신청");
    expect(message).toContain("여권 신청");
  });

  it("excludes completed reverse-plan watcher from push", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    const statuses = new Map<number, string>(result.tasks.map((t) => [t.id, "done"]));

    const rows = findWatchersForPush(conn.db);
    const { items } = selectDueForPush(rows, DATE, NOW, statuses);
    expect(items).toHaveLength(0);
  });

  it("excludes snoozed reverse-plan watcher from push until expiry", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    const futureSnoozed = "2026-07-20T00:00:00+00:00";
    conn.sqlite
      .prepare("UPDATE watchers SET snoozed_until=? WHERE id=?")
      .run(futureSnoozed, result.watcher.id);

    const statuses = new Map<number, string>(result.tasks.map((t) => [t.id, "todo"]));
    const rows = findWatchersForPush(conn.db);
    const { items } = selectDueForPush(rows, DATE, NOW, statuses);
    expect(items).toHaveLength(0);
  });
});
