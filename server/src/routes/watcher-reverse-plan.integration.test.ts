import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";
import { createReversePlanWatcher } from "../repositories/watchers.js";
import { selectDueForPush } from "../services/watcher-daily-push.js";
import { findWatchersForPush } from "../repositories/watchers.js";

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

    // watcher created
    expect(result.watcher.id).toBeGreaterThan(0);
    expect(result.watcher.kind).toBe("A");
    expect(result.watcher.armed).toBe(1);

    // step tasks created
    expect(result.taskIds).toHaveLength(2);
    expect(result.targetTaskId).toBeGreaterThan(0);

    // links created: N-1 step-step + 1 target-lastStep = 2 for 2 steps
    expect(result.linkIds).toHaveLength(2);

    // verify link direction: targetTask requires lastStepTask
    const lastStepId = result.taskIds[result.taskIds.length - 1]!;
    const targetLink = conn.sqlite
      .prepare("SELECT * FROM links WHERE from_id=? AND to_id=? AND kind='requires'")
      .get(result.targetTaskId, lastStepId);
    expect(targetLink).toBeTruthy();

    // verify step1 requires step0
    const stepLink = conn.sqlite
      .prepare("SELECT * FROM links WHERE from_id=? AND to_id=? AND kind='requires'")
      .get(result.taskIds[1]!, result.taskIds[0]!);
    expect(stepLink).toBeTruthy();
  });

  it("stored rule has type=reverse_plan and taskIds", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);
    const rule = JSON.parse(result.watcher.rule ?? "{}") as Record<string, unknown>;
    expect(rule.type).toBe("reverse_plan");
    expect(rule.targetTaskId).toBe(result.targetTaskId);
    const steps = rule.steps as Array<{ taskId: number }>;
    expect(steps[0]!.taskId).toBe(result.taskIds[0]!);
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
      .get(result.linkIds[0]!) as { firmness: string; source: string };
    expect(link.firmness).toBe("hard");
    expect(link.source).toBe("authored");
  });

  it("rejects invalid targetDate", () => {
    const conn = makeTestDb();
    expect(() =>
      createReversePlanWatcher(conn.db, {
        ...BASE_RP_INPUT,
        targetDate: "2026-02-30"
      })
    ).toThrow();
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
    expect(rp.nextStepIndex).toBe(0); // first step not done yet
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

    // Mark all step tasks as done
    for (const taskId of result.taskIds) {
      conn.sqlite.prepare("UPDATE tasks SET status='done' WHERE id=?").run(taskId);
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
  it("creates watcher and returns result", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);
    const resp = await app.inject({
      method: "POST",
      url: "/api/watchers/reverse-plan",
      headers: { "Content-Type": "application/json" },
      payload: JSON.stringify(BASE_RP_INPUT)
    });
    expect(resp.statusCode).toBe(201);
    const body = JSON.parse(resp.payload) as { ok: boolean; data: { watcher: { id: number }; taskIds: number[] } };
    expect(body.ok).toBe(true);
    expect(body.data.watcher.id).toBeGreaterThan(0);
    expect(body.data.taskIds).toHaveLength(2);
  });

  it("returns 400 for invalid targetDate", async () => {
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
    const body = JSON.parse(resp.payload) as { data: { watcherBubbles: Array<{ id: number }> } };
    expect(body.data.watcherBubbles.length).toBeGreaterThan(0);
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
    for (const id of result.taskIds) {
      conn.sqlite.prepare("UPDATE tasks SET status='done' WHERE id=?").run(id);
    }

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
  it("includes due reverse-plan watcher in push digest", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    // Mark step tasks as todo (not done)
    const stepIds = result.taskIds;
    const statuses = new Map<number, string>(stepIds.map((id) => [id, "todo"]));

    const rows = findWatchersForPush(conn.db);
    const { items } = selectDueForPush(rows, DATE, NOW, statuses);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.id).toBe(result.watcher.id);
  });

  it("excludes completed reverse-plan watcher from push", () => {
    const conn = makeTestDb();
    const result = createReversePlanWatcher(conn.db, BASE_RP_INPUT);

    const statuses = new Map<number, string>(result.taskIds.map((id) => [id, "done"]));

    const rows = findWatchersForPush(conn.db);
    const { items } = selectDueForPush(rows, DATE, NOW, statuses);
    expect(items).toHaveLength(0);
  });
});
