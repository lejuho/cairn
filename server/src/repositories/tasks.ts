import { eq } from "drizzle-orm";
import type { CreateTaskRequest, PatchThreadTaskNodeRequest, TaskRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { tasks } from "../db/schema.js";

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
