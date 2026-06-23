import { eq, inArray } from "drizzle-orm";
import type { CreateReversePlanWatcherRequest, CreateWatcherRequest, ReversePlanData, ReversePlanView, WatcherRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { links, tasks, watchers } from "../db/schema.js";
import { computeReversePlan } from "../services/watcher-reverse-plan.js";

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

export type TaskSummary = { id: number; title: string | null; status: string | null; due: string | null };
export type LinkSummary = { id: number; fromId: number | null; toId: number | null; kind: string | null };

export type CreateReversePlanResult = {
  watcher: WatcherRow;
  tasks: TaskSummary[];    // step tasks in execution order
  targetTask: TaskSummary; // the terminal milestone task
  links: LinkSummary[];
  reversePlan: ReversePlanView;
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
    const stepTaskRows: TaskSummary[] = [];
    for (const step of computedSteps) {
      const [taskRow] = tx
        .insert(tasks)
        .values({ title: step.label, due: step.latestDate, status: "todo" })
        .returning({ id: tasks.id, title: tasks.title, status: tasks.status, due: tasks.due })
        .all();
      stepTaskRows.push(taskRow as TaskSummary);
    }

    // 2. Insert target task
    const [targetRow] = tx
      .insert(tasks)
      .values({ title: targetLabel, due: input.targetDate, status: "todo" })
      .returning({ id: tasks.id, title: tasks.title, status: tasks.status, due: tasks.due })
      .all();
    const targetTask = targetRow as TaskSummary;

    // 3. Build rule JSON (complete with taskIds)
    const ruleSteps: ReversePlanData["steps"] = computedSteps.map((s, i) => ({
      label: s.label,
      leadDays: s.leadDays,
      latestDate: s.latestDate,
      taskId: stepTaskRows[i]!.id
    }));
    const ruleData: ReversePlanData = {
      type: "reverse_plan",
      targetDate: input.targetDate,
      targetLabel,
      safetyDays: input.safetyDays,
      steps: ruleSteps,
      targetTaskId: targetTask.id
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
    const linkRows: LinkSummary[] = [];
    const lastStepTaskId = stepTaskRows[stepTaskRows.length - 1]!.id;

    for (let i = 1; i < stepTaskRows.length; i++) {
      const [linkRow] = tx
        .insert(links)
        .values({
          fromId: stepTaskRows[i]!.id,
          fromKind: "task",
          toId: stepTaskRows[i - 1]!.id,
          toKind: "task",
          kind: "requires",
          firmness: "hard",
          source: "authored"
        })
        .returning({ id: links.id, fromId: links.fromId, toId: links.toId, kind: links.kind })
        .all();
      linkRows.push(linkRow as LinkSummary);
    }

    const [targetLinkRow] = tx
      .insert(links)
      .values({
        fromId: targetTask.id,
        fromKind: "task",
        toId: lastStepTaskId,
        toKind: "task",
        kind: "requires",
        firmness: "hard",
        source: "authored"
      })
      .returning({ id: links.id, fromId: links.fromId, toId: links.toId, kind: links.kind })
      .all();
    linkRows.push(targetLinkRow as LinkSummary);

    // Build the reverse-plan view for the client (all steps are "todo" at creation)
    const reversePlan: ReversePlanView = {
      targetDate: input.targetDate,
      targetLabel,
      safetyDays: input.safetyDays,
      steps: ruleSteps.map((s) => ({ ...s, taskStatus: "todo" })),
      nextStepIndex: 0,
      completed: false
    };

    return { watcher, tasks: stepTaskRows, targetTask, links: linkRows, reversePlan };
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
