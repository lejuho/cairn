import type {
  CreateThreadLinkRequest,
  EventRow,
  TaskRow,
  ThreadDetail,
  ThreadLinkRow,
  ThreadProgress,
  ThreadRelations,
  ThreadRollup,
  ThreadRow,
  ThreadSummary
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import {
  countLinksForAllThreads,
  createThread as repoCreate,
  deleteLinkById,
  findCompletedThreadsByKind,
  findContainsAdjacency,
  findDuplicateLink,
  findEventTitlesByThreadIds,
  findEventsByThreadId,
  findEventsSlimByThreadIds,
  findHardContainsEdges,
  findHardContainsParent,
  findLinksWithPeers,
  findTaskTitlesByThreadIds,
  findTasksByThreadId,
  findTasksSlimByThreadIds,
  findThreadById,
  findThreadNamesByIds,
  findThreadsByIds,
  insertLink,
  listThreads as repoList
} from "../repositories/threads.js";
import { findThreadNodeLinks } from "../repositories/links.js";
import { findEventsWithCostsByThreadId } from "../repositories/events.js";
import { computeThreadUnknownBlockers } from "./thread-unknown-blockers.js";
import { computeThreadSettlement } from "./thread-settlement.js";
import { computeThreadMissingNodeSuggestions } from "./thread-missing-node-suggestions.js";
import { wouldCreateContainsCycle } from "./thread-links.js";
import { computeRollup } from "./thread-rollup.js";
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
  const rollup = buildRollup(db, id);
  const nodeLinks = findThreadNodeLinks(db, id);
  const unknownBlockers = computeThreadUnknownBlockers(threadEvents, threadTasks, nodeLinks);
  const settlement = computeThreadSettlement(thread, findEventsWithCostsByThreadId(db, thread.id), threadTasks);

  // Missing-node suggestions (cycle-54): only load historical evidence for an
  // eligible target (non-empty kind, not done/dropped); else skip the reads.
  const kind = thread.kind?.trim();
  let missingNodeSuggestions: ThreadDetail["missingNodeSuggestions"] = [];
  if (kind && thread.status !== "done" && thread.status !== "dropped") {
    const evidenceThreads = findCompletedThreadsByKind(db, kind, thread.id);
    const evidenceIds = evidenceThreads.map((t) => t.id);
    missingNodeSuggestions = computeThreadMissingNodeSuggestions(
      thread,
      threadEvents,
      threadTasks,
      evidenceThreads,
      findEventTitlesByThreadIds(db, evidenceIds),
      findTaskTitlesByThreadIds(db, evidenceIds)
    );
  }

  return { thread, events: threadEvents, tasks: threadTasks, progress, relations, rollup, nodeLinks, unknownBlockers, settlement, missingNodeSuggestions };
}

function buildRollup(db: CairnDatabase, rootId: number): ThreadRollup {
  const edges = findHardContainsEdges(db);

  // Collect all thread ids we need (root + reachable descendants) for a single batch read.
  const adj = new Map<number, number[]>();
  for (const e of edges) {
    const ch = adj.get(e.parentId) ?? [];
    ch.push(e.childId);
    adj.set(e.parentId, ch);
  }
  const reachable = new Set<number>([rootId]);
  const queue = [...(adj.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(adj.get(id) ?? []));
  }
  const allIds = [...reachable];

  const eventsSlim = findEventsSlimByThreadIds(db, allIds);
  const tasksSlim = findTasksSlimByThreadIds(db, allIds);
  const nameById = findThreadNamesByIds(db, allIds);

  const eventsByThread = new Map<number, typeof eventsSlim>();
  for (const e of eventsSlim) {
    const bucket = eventsByThread.get(e.threadId) ?? [];
    bucket.push(e);
    eventsByThread.set(e.threadId, bucket);
  }
  const tasksByThread = new Map<number, typeof tasksSlim>();
  for (const t of tasksSlim) {
    const bucket = tasksByThread.get(t.threadId) ?? [];
    bucket.push(t);
    tasksByThread.set(t.threadId, bucket);
  }

  return computeRollup({ rootId, edges, eventsByThread, tasksByThread, nameById });
}

export type CreateThreadLinkResult =
  | { status: "created"; link: ThreadLinkRow }
  | { status: "existing"; link: ThreadLinkRow }
  | { status: "error"; code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONTAINS_CYCLE" | "CONTAINS_PARENT_CONFLICT"; message: string };

export function createThreadLink(
  db: CairnDatabase,
  fromThreadId: number,
  input: CreateThreadLinkRequest
): CreateThreadLinkResult {
  const { toThreadId, kind, firmness } = input;

  if (fromThreadId === toThreadId) {
    return { status: "error", code: "VALIDATION_ERROR", message: "Cannot link a thread to itself" };
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
