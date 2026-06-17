import type { EventRow, TaskRow, ThreadDetail, ThreadProgress, ThreadRow, ThreadSummary } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import {
  createThread as repoCreate,
  findEventsByThreadId,
  findTasksByThreadId,
  findThreadById,
  listThreads as repoList
} from "../repositories/threads.js";
import type { CreateThreadRequest } from "@cairn/shared";

export function createThread(db: CairnDatabase, input: CreateThreadRequest): ThreadRow {
  return repoCreate(db, input);
}

function computeProgress(events: EventRow[], tasks: TaskRow[]): ThreadProgress {
  const EXCLUDED = new Set(["cancelled", "dropped"]);
  const allItems = [
    ...events.map((e) => e.status),
    ...tasks.map((t) => t.status)
  ].filter((s) => s != null && !EXCLUDED.has(s));
  const done = allItems.filter((s) => s === "done").length;
  return { done, total: allItems.length };
}

export function listThreads(db: CairnDatabase): ThreadSummary[] {
  const rows = repoList(db);
  return rows.map((thread) => {
    const threadEvents = findEventsByThreadId(db, thread.id);
    const threadTasks = findTasksByThreadId(db, thread.id);
    const EXCLUDED = new Set(["cancelled", "dropped"]);
    const allItems = [
      ...threadEvents.map((e) => e.status),
      ...threadTasks.map((t) => t.status)
    ].filter((s) => s != null && !EXCLUDED.has(s));
    return {
      thread,
      eventCount: threadEvents.length,
      taskCount: threadTasks.length,
      doneCount: allItems.filter((s) => s === "done").length,
      totalCount: allItems.length
    };
  });
}

export function getThreadDetail(db: CairnDatabase, id: number): ThreadDetail | null {
  const thread = findThreadById(db, id);
  if (!thread) return null;
  const threadEvents = findEventsByThreadId(db, thread.id);
  const threadTasks = findTasksByThreadId(db, thread.id);
  const progress = computeProgress(threadEvents, threadTasks);
  return { thread, events: threadEvents, tasks: threadTasks, progress };
}
