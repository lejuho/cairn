import { eq } from "drizzle-orm";
import { isCalendarDate, type CreateTaskRequest, type EventRow, type PatchThreadTaskNodeRequest, type TaskRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { events, tasks } from "../db/schema.js";
import { addDays } from "../utils/rfc3339.js";

export const TASK_PROMPT_LOOKAHEAD_DAYS = 7;
const TASK_PROMPT_LIMIT = 3;
const PROMPT_STATUSES = new Set(["todo", "doing"]);
// A scheduled task block "occupies" the task only while its event is a live
// Cairn block (cycle-63 FR-SLOT-07A). cancelled/moved/missing referenced events
// are NOT active, so the task can surface again.
const ACTIVE_BLOCK_STATUSES = new Set(["planned", "confirmed", "done"]);

// Due-task schedule-prompt eligibility (cycle-62 FR-SLOT-06C), evaluated
// against a reference date (the Today query date for the prompt list, the
// candidate query date, or the dismiss date). Date-only: a task is eligible
// when it is open, has a positive estimate (no guessed duration), and has a
// real calendar due date within `lookaheadDays` of the reference (overdue
// included). The dismiss filter is applied separately by the prompt list.
export function isTaskPromptEligible(
  task: TaskRow,
  referenceDate: string,
  lookaheadDays = TASK_PROMPT_LOOKAHEAD_DAYS
): boolean {
  if (task.status == null || !PROMPT_STATUSES.has(task.status)) return false;
  if (task.estMinutes == null || task.estMinutes <= 0) return false;
  if (task.due == null || !isCalendarDate(task.due)) return false;
  if (task.due > addDays(referenceDate, lookaheadDays)) return false;
  return true;
}

export function createTask(db: CairnDatabase, input: CreateTaskRequest): TaskRow {
  const [row] = db
    .insert(tasks)
    .values({
      title: input.title,
      estMinutes: input.estMinutes ?? null,
      due: input.due ?? null,
      context: input.context ?? null,
      threadId: input.threadId ?? null,
      optional: input.optional ? 1 : 0,
      status: "todo"
    })
    .returning()
    .all();
  return row as TaskRow;
}

export function findTaskById(db: CairnDatabase, id: number): TaskRow | null {
  const [row] = db.select().from(tasks).where(eq(tasks.id, id)).all();
  return (row as TaskRow) ?? null;
}

export function updateTaskStatus(
  db: CairnDatabase,
  id: number,
  status: "todo" | "doing" | "done" | "dropped"
): TaskRow | null {
  const [row] = db
    .update(tasks)
    .set({ status })
    .where(eq(tasks.id, id))
    .returning()
    .all();
  return (row as TaskRow) ?? null;
}

// Thread node inline edit (cycle-50 FR-THR-06). Mutates ONLY the allowed
// columns present in the patch — status/threadId are never touched. Key
// presence (`in`) preserves an explicit null for estMinutes/due/context.
export function updateTaskThreadNode(
  db: CairnDatabase,
  id: number,
  patch: PatchThreadTaskNodeRequest
): TaskRow | null {
  const set: Partial<typeof tasks.$inferInsert> = {};
  if ("title" in patch) set.title = patch.title!;
  if ("estMinutes" in patch) set.estMinutes = patch.estMinutes ?? null;
  if ("due" in patch) set.due = patch.due ?? null;
  if ("context" in patch) set.context = patch.context ?? null;
  if ("optional" in patch) set.optional = patch.optional ? 1 : 0;
  const [row] = db.update(tasks).set(set).where(eq(tasks.id, id)).returning().all();
  return (row as TaskRow) ?? null;
}

export function findTwoMinuteTodoTasks(db: CairnDatabase): TaskRow[] {
  return db
    .select()
    .from(tasks)
    .all()
    .filter(
      (t) =>
        t.status === "todo" &&
        t.estMinutes != null &&
        t.estMinutes <= 2
    ) as TaskRow[];
}

// True when the task already has an active scheduled block (cycle-63): its
// scheduled_event_id points to a live Cairn block event (non-null start/end,
// source='cairn', self_imposed=1, status planned|confirmed|done). A
// cancelled/moved/missing referenced event returns false so the task resurfaces.
export function hasActiveScheduledBlock(db: CairnDatabase, task: TaskRow): boolean {
  if (task.scheduledEventId == null) return false;
  const ev = db.select().from(events).where(eq(events.id, task.scheduledEventId)).get();
  if (!ev) return false;
  return (
    ev.start != null &&
    ev.end != null &&
    ev.source === "cairn" &&
    ev.selfImposed === 1 &&
    ev.status != null &&
    ACTIVE_BLOCK_STATUSES.has(ev.status)
  );
}

// Up to three due-imminent task schedule prompts for the Today date (cycle-62
// FR-SLOT-06C). Excludes tasks dismissed for that exact date and tasks that
// already have an active scheduled block (cycle-63). Sort: overdue first, then
// due date asc, then required-before-optional, then id asc.
export function findDueTaskSchedulePrompts(
  db: CairnDatabase,
  todayDate: string,
  lookaheadDays = TASK_PROMPT_LOOKAHEAD_DAYS
): TaskRow[] {
  const rows = db.select().from(tasks).all() as TaskRow[];
  return rows
    .filter((t) => isTaskPromptEligible(t, todayDate, lookaheadDays))
    .filter((t) => t.schedulePromptDismissedOn !== todayDate)
    .filter((t) => !hasActiveScheduledBlock(db, t))
    .sort((a, b) => {
      const aOverdue = a.due! < todayDate ? 0 : 1;
      const bOverdue = b.due! < todayDate ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      if (a.due! !== b.due!) return a.due! < b.due! ? -1 : 1;
      const aOpt = a.optional ?? 0;
      const bOpt = b.optional ?? 0;
      if (aOpt !== bOpt) return aOpt - bOpt;
      return a.id - b.id;
    })
    .slice(0, TASK_PROMPT_LIMIT);
}

// Hide a due-task schedule prompt for one Today date. Re-checks eligibility
// against the dismiss date (i.e. eligible "except for the current dismiss
// value"); writes ONLY schedule_prompt_dismissed_on (tasks have no updated_at).
// Idempotent: re-dismissing the same date re-writes the same value. Returns
// true iff the task was prompt-eligible and written.
export function dismissTaskSchedulePromptForDate(
  db: CairnDatabase,
  taskId: number,
  dismissedOn: string
): boolean {
  const task = findTaskById(db, taskId);
  if (!task || !isTaskPromptEligible(task, dismissedOn)) return false;
  db.update(tasks).set({ schedulePromptDismissedOn: dismissedOn }).where(eq(tasks.id, taskId)).run();
  return true;
}

// Apply a task slot candidate (cycle-63 FR-SLOT-07A). All-or-none in one
// better-sqlite3 sync transaction: insert ONE scheduled Cairn block event from
// the task + selected start/end, then set ONLY tasks.scheduled_event_id to it.
// Task status/due/estimate/optional/thread are NOT touched; no links row.
export function scheduleTaskBlock(
  db: CairnDatabase,
  task: TaskRow,
  start: string,
  end: string
): { task: TaskRow; event: EventRow } {
  return db.transaction((tx) => {
    const [event] = tx
      .insert(events)
      .values({
        title: task.title,
        threadId: task.threadId,
        start,
        end,
        type: "task",
        mode: "async",
        source: "cairn",
        selfImposed: 1,
        status: "planned"
      })
      .returning()
      .all();
    const [updated] = tx
      .update(tasks)
      .set({ scheduledEventId: (event as EventRow).id })
      .where(eq(tasks.id, task.id))
      .returning()
      .all();
    return { task: updated as TaskRow, event: event as EventRow };
  });
}
