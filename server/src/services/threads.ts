import type {
  CreateThreadLinkRequest,
  EventRow,
  TaskRow,
  ThreadDetail,
  ThreadLinkRow,
  ThreadProgress,
  ThreadRelations,
  ThreadRow,
  ThreadSummary
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import {
  countLinksForAllThreads,
  createThread as repoCreate,
  deleteLinkById,
  findContainsAdjacency,
  findDuplicateLink,
  findEventsByThreadId,
  findHardContainsParent,
  findLinksWithPeers,
  findTasksByThreadId,
  findThreadById,
  findThreadsByIds,
  insertLink,
  listThreads as repoList
} from "../repositories/threads.js";
import { wouldCreateContainsCycle } from "./thread-links.js";
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
  const counts = countLinksForAllThreads(db);
  return rows.map((thread) => {
    const threadEvents = findEventsByThreadId(db, thread.id);
    const threadTasks = findTasksByThreadId(db, thread.id);
    const EXCLUDED = new Set(["cancelled", "dropped"]);
    const allItems = [
      ...threadEvents.map((e) => e.status),
      ...threadTasks.map((t) => t.status)
    ].filter((s) => s != null && !EXCLUDED.has(s));
    const c = counts.get(thread.id) ?? { incoming: 0, outgoing: 0 };
    return {
      thread,
      eventCount: threadEvents.length,
      taskCount: threadTasks.length,
      doneCount: allItems.filter((s) => s === "done").length,
      totalCount: allItems.length,
      relationCounts: { incoming: c.incoming, outgoing: c.outgoing }
    };
  });
}

export function getThreadDetail(db: CairnDatabase, id: number): ThreadDetail | null {
  const thread = findThreadById(db, id);
  if (!thread) return null;
  const threadEvents = findEventsByThreadId(db, thread.id);
  const threadTasks = findTasksByThreadId(db, thread.id);
  const progress = computeProgress(threadEvents, threadTasks);
  const relations: ThreadRelations = findLinksWithPeers(db, id);
  return { thread, events: threadEvents, tasks: threadTasks, progress, relations };
}

export type CreateThreadLinkResult =
  | { status: "created"; link: ThreadLinkRow }
  | { status: "existing"; link: ThreadLinkRow }
  | { status: "error"; code: "SELF_LINK" | "VALIDATION_ERROR" | "NOT_FOUND" | "CONTAINS_CYCLE" | "CONTAINS_PARENT_CONFLICT"; message: string };

export function createThreadLink(
  db: CairnDatabase,
  fromThreadId: number,
  input: CreateThreadLinkRequest
): CreateThreadLinkResult {
  const { toThreadId, kind, firmness } = input;

  if (fromThreadId === toThreadId) {
    return { status: "error", code: "SELF_LINK", message: "Cannot link a thread to itself" };
  }

  const both = findThreadsByIds(db, [fromThreadId, toThreadId]);
  if (both.length !== 2 || !both.find((t) => t.id === fromThreadId) || !both.find((t) => t.id === toThreadId)) {
    return { status: "error", code: "NOT_FOUND", message: "One or both threads not found" };
  }

  const dup = findDuplicateLink(db, fromThreadId, toThreadId, kind);
  if (dup) {
    return { status: "existing", link: dup };
  }

  if (kind === "contains") {
    const adjacency = findContainsAdjacency(db);
    if (wouldCreateContainsCycle(fromThreadId, toThreadId, adjacency)) {
      return { status: "error", code: "CONTAINS_CYCLE", message: "This link would create a contains cycle" };
    }

    if (firmness === "hard") {
      const conflict = findHardContainsParent(db, toThreadId, fromThreadId);
      if (conflict) {
        return {
          status: "error",
          code: "CONTAINS_PARENT_CONFLICT",
          message: "This thread already has a hard contains parent"
        };
      }
    }
  }

  const link = insertLink(db, fromThreadId, toThreadId, kind, firmness);
  return { status: "created", link };
}

export type DeleteThreadLinkResult =
  | { status: "deleted" }
  | { status: "error"; code: "NOT_FOUND" | "VALIDATION_ERROR"; message: string };

export function deleteThreadLink(
  db: CairnDatabase,
  fromThreadId: number,
  linkId: number
): DeleteThreadLinkResult {
  const deleted = deleteLinkById(db, linkId, fromThreadId);
  if (!deleted) {
    return {
      status: "error",
      code: "NOT_FOUND",
      message: "Link not found or is not outgoing from this thread"
    };
  }
  return { status: "deleted" };
}
