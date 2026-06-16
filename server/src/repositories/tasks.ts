import { eq } from "drizzle-orm";
import type { CreateTaskRequest, TaskRow } from "@cairn/shared";
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
