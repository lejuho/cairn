import { asc, desc, eq } from "drizzle-orm";
import type { CreateThreadRequest, EventRow, TaskRow, ThreadRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { events, tasks, threads } from "../db/schema.js";

export function createThread(db: CairnDatabase, input: CreateThreadRequest): ThreadRow {
  const [row] = db
    .insert(threads)
    .values({
      name: input.name,
      kind: input.kind ?? null,
      goal: input.goal ?? null,
      deadline: input.deadline ?? null,
      status: "active"
    })
    .returning()
    .all();
  return row as ThreadRow;
}

export function listThreads(db: CairnDatabase): ThreadRow[] {
  return db
    .select()
    .from(threads)
    .orderBy(desc(threads.createdAt), desc(threads.id))
    .all() as ThreadRow[];
}

export function findThreadById(db: CairnDatabase, id: number): ThreadRow | null {
  const row = db.select().from(threads).where(eq(threads.id, id)).get();
  return row ? (row as ThreadRow) : null;
}

export function findEventsByThreadId(db: CairnDatabase, threadId: number): EventRow[] {
  return db
    .select()
    .from(events)
    .where(eq(events.threadId, threadId))
    .all()
    .sort((a, b) => {
      if (a.start == null && b.start == null) return 0;
      if (a.start == null) return 1;
      if (b.start == null) return -1;
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    }) as EventRow[];
}

export function findTasksByThreadId(db: CairnDatabase, threadId: number): TaskRow[] {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.threadId, threadId))
    .orderBy(asc(tasks.createdAt))
    .all() as TaskRow[];
}
