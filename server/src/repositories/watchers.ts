import { eq, inArray } from "drizzle-orm";
import type { CreateWatcherRequest, ReversePlanData, WatcherRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { links, tasks, watchers } from "../db/schema.js";
import { computeReversePlan } from "../services/watcher-reverse-plan.js";
import type { CreateReversePlanWatcherRequest } from "@cairn/shared";

export function createWatcher(
  db: CairnDatabase,
  input: CreateWatcherRequest
): WatcherRow {
  const rule = JSON.stringify({ type: "date_threshold", fireOn: input.threshold });
  const [row] = db
    .insert(watchers)
    .values({
      label: input.label,
      threshold: input.threshold,
      category: input.category ?? null,
      kind: "A",
      armed: 1,
      rule
    })
    .returning()
    .all();
  return row as WatcherRow;
}

export function snoozeWatcher(
  db: CairnDatabase,
  id: number,
  snoozedUntil: string
): WatcherRow | null {
  const [row] = db
    .update(watchers)
    .set({ snoozedUntil })
    .where(eq(watchers.id, id))
    .returning()
    .all();
  return (row as WatcherRow) ?? null;
}

// Returns armed kind-A rows for the pure evaluator. Date/snooze filtering
// is deferred to the service so rule parsing stays in one place.
export function findAllWatchersForEvaluation(db: CairnDatabase): WatcherRow[] {
  return db
    .select()
    .from(watchers)
    .all()
    .filter((w) => w.armed === 1 && w.kind === "A") as WatcherRow[];
}

// Returns all watcher rows, no filter, ordered by id asc. Deep-view service
// handles status derivation and sort.
export function findAllWatchers(db: CairnDatabase): WatcherRow[] {
  return db.select().from(watchers).orderBy(watchers.id).all() as WatcherRow[];
}

// Updates only the armed flag. Returns the updated row or null if not found.
export function setWatcherArmed(db: CairnDatabase, id: number, armed: boolean): WatcherRow | null {
  const [row] = db
    .update(watchers)
    .set({ armed: armed ? 1 : 0 })
    .where(eq(watchers.id, id))
    .returning()
    .all();
  return (row as WatcherRow) ?? null;
}

// Returns armed kind-A rows for the push job. Mirrors findAllWatchersForEvaluation
// but is a separate function so future changes to each filter stay independent.
export function findWatchersForPush(db: CairnDatabase): WatcherRow[] {
  return db
    .select()
    .from(watchers)
    .all()
    .filter((w) => w.armed === 1 && w.kind === "A") as WatcherRow[];
}

// Sets last_fired for a set of watcher ids. firedAt is the ISO8601 timestamp
// of the send instant. No-op when ids is empty.
export function markWatchersFired(
  db: CairnDatabase,
  ids: number[],
  firedAt: string
): void {
  if (ids.length === 0) return;
  db.update(watchers)
    .set({ lastFired: firedAt })
    .where(inArray(watchers.id, ids))
    .run();
}

export type CreateReversePlanResult = {
  watcher: WatcherRow;
  taskIds: number[];
  targetTaskId: number;
  linkIds: number[];
  reversePlan: ReversePlanData;
};

// Creates a reverse-plan watcher with generated step tasks and requires links
// in a single SQLite transaction. Throws (and rolls back) on any failure.
//
// Link direction: downstream `from` requires upstream `to`.
//   targetTask requires lastStepTask;  stepN requires step(N-1).
export function createReversePlanWatcher(
  db: CairnDatabase,
  input: CreateReversePlanWatcherRequest
): CreateReversePlanResult {
  const computed = computeReversePlan(input);
  if (!computed.ok) throw new Error(computed.error);

  const { computedSteps, firstThreshold } = computed;
  const targetLabel = input.targetLabel ?? input.label;

  return db.transaction((tx) => {
    // 1. Insert step tasks (execution order → index 0 first)
    const stepTaskIds: number[] = [];
    for (const step of computedSteps) {
      const [taskRow] = tx
        .insert(tasks)
        .values({ title: step.label, due: step.latestDate, status: "todo" })
        .returning()
        .all();
      stepTaskIds.push((taskRow as { id: number }).id);
    }

    // 2. Insert target task
    const [targetRow] = tx
      .insert(tasks)
      .values({ title: targetLabel, due: input.targetDate, status: "todo" })
      .returning()
      .all();
    const targetTaskId = (targetRow as { id: number }).id;

    // 3. Build rule JSON (complete with taskIds)
    const ruleSteps: ReversePlanData["steps"] = computedSteps.map((s, i) => ({
      label: s.label,
      leadDays: s.leadDays,
      latestDate: s.latestDate,
      taskId: stepTaskIds[i]!
    }));
    const ruleData: ReversePlanData = {
      type: "reverse_plan",
      targetDate: input.targetDate,
      targetLabel,
      safetyDays: input.safetyDays,
      steps: ruleSteps,
      targetTaskId
    };
    const rule = JSON.stringify(ruleData);

    // 4. Insert watcher (threshold = first step's latestDate)
    const [watcherRow] = tx
      .insert(watchers)
      .values({
        label: input.label,
        category: input.category ?? null,
        kind: "A",
        armed: 1,
        rule,
        threshold: firstThreshold
      })
      .returning()
      .all();
    const watcher = watcherRow as WatcherRow;

    // 5. Insert requires links (downstream from → upstream to)
    //    - stepN requires step(N-1) for N > 0
    //    - targetTask requires lastStepTask
    const linkIds: number[] = [];
    const lastStepTaskId = stepTaskIds[stepTaskIds.length - 1]!;

    for (let i = 1; i < stepTaskIds.length; i++) {
      const [linkRow] = tx
        .insert(links)
        .values({
          fromId: stepTaskIds[i]!,
          fromKind: "task",
          toId: stepTaskIds[i - 1]!,
          toKind: "task",
          kind: "requires",
          firmness: "hard",
          source: "authored"
        })
        .returning()
        .all();
      linkIds.push((linkRow as { id: number }).id);
    }

    const [targetLinkRow] = tx
      .insert(links)
      .values({
        fromId: targetTaskId,
        fromKind: "task",
        toId: lastStepTaskId,
        toKind: "task",
        kind: "requires",
        firmness: "hard",
        source: "authored"
      })
      .returning()
      .all();
    linkIds.push((targetLinkRow as { id: number }).id);

    return { watcher, taskIds: stepTaskIds, targetTaskId, linkIds, reversePlan: ruleData };
  });
}

// Returns a map of taskId → status for the given set of task ids.
// Missing task ids (deleted manually) are omitted from the map.
export function findTaskStatusesByIds(
  db: CairnDatabase,
  ids: number[]
): Map<number, string> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .all()
    .filter((r) => ids.includes(r.id));
  const map = new Map<number, string>();
  for (const r of rows) {
    if (r.status != null) map.set(r.id, r.status);
  }
  return map;
}
