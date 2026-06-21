import type { EventRow, TaskRow, ThreadProgress, ThreadRollup, ThreadRollupChild } from "@cairn/shared";
import type { ContainsEdge, EventSlim, TaskSlim } from "../repositories/threads.js";

const EXCLUDED_STATUSES = new Set(["cancelled", "dropped"]);

function computeProgressFromSlim(events: EventSlim[], tasks: TaskSlim[]): ThreadProgress {
  const statuses = [
    ...events.map((e) => e.status),
    ...tasks.map((t) => t.status)
  ].filter((s) => s != null && !EXCLUDED_STATUSES.has(s)) as string[];
  return {
    done: statuses.filter((s) => s === "done").length,
    total: statuses.length
  };
}

// Same logic as computeProgress in services/threads.ts but typed for EventRow/TaskRow.
export function computeProgressFromRows(events: EventRow[], tasks: TaskRow[]): ThreadProgress {
  const statuses = [
    ...events.map((e) => e.status),
    ...tasks.map((t) => t.status)
  ].filter((s) => s != null && !EXCLUDED_STATUSES.has(s)) as string[];
  return {
    done: statuses.filter((s) => s === "done").length,
    total: statuses.length
  };
}

function computeEnergyHours(events: EventSlim[]): number {
  let total = 0;
  for (const e of events) {
    if (e.start == null || e.end == null) continue;
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    if (isNaN(start) || isNaN(end)) continue;
    const durationHours = Math.max(0, (end - start) / 3_600_000);
    total += durationHours;
  }
  return total;
}

export type RollupInput = {
  rootId: number;
  edges: ContainsEdge[];
  eventsByThread: Map<number, EventSlim[]>;
  tasksByThread: Map<number, TaskSlim[]>;
  nameById: Map<number, string>;
};

// BFS traversal of hard contains descendants.
// Returns sorted children array and CONTAINS_CYCLE_DETECTED warning when needed.
export function computeRollup(input: RollupInput): ThreadRollup {
  const { rootId, edges, eventsByThread, tasksByThread, nameById } = input;

  // Build adjacency: parentId → [{childId, relationId}]
  const adj = new Map<number, Array<{ childId: number; relationId: number }>>();
  for (const e of edges) {
    const children = adj.get(e.parentId) ?? [];
    children.push({ childId: e.childId, relationId: e.relationId });
    adj.set(e.parentId, children);
  }

  // BFS from root; visited seeded with root to exclude self.
  const visited = new Set<number>([rootId]);
  const warnings: string[] = [];
  type BFSNode = { threadId: number; depth: number; relationId: number };
  const queue: BFSNode[] = [];
  const descendantNodes: BFSNode[] = [];

  for (const { childId, relationId } of adj.get(rootId) ?? []) {
    queue.push({ threadId: childId, depth: 1, relationId });
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.threadId)) {
      // Historical cycle or duplicate path — warn once.
      if (!warnings.includes("CONTAINS_CYCLE_DETECTED")) {
        warnings.push("CONTAINS_CYCLE_DETECTED");
      }
      continue;
    }
    visited.add(node.threadId);
    descendantNodes.push(node);

    for (const { childId, relationId } of adj.get(node.threadId) ?? []) {
      queue.push({ threadId: childId, depth: node.depth + 1, relationId });
    }
  }

  // Direct metrics (root only)
  const directEvents = eventsByThread.get(rootId) ?? [];
  const directTasks = tasksByThread.get(rootId) ?? [];
  const directProgress = computeProgressFromSlim(directEvents, directTasks);
  const directEnergy = computeEnergyHours(directEvents);

  // Descendant aggregate
  let descDone = 0;
  let descTotal = 0;
  let descEnergy = 0;
  const childrenOutput: ThreadRollupChild[] = [];

  for (const node of descendantNodes) {
    const evts = eventsByThread.get(node.threadId) ?? [];
    const tsks = tasksByThread.get(node.threadId) ?? [];
    const prog = computeProgressFromSlim(evts, tsks);
    const energy = computeEnergyHours(evts);
    descDone += prog.done;
    descTotal += prog.total;
    descEnergy += energy;

    childrenOutput.push({
      thread: { id: node.threadId, name: nameById.get(node.threadId) ?? String(node.threadId) },
      depth: node.depth,
      relationId: node.relationId,
      progress: prog,
      energyHours: energy,
      descendantCount: 0 // filled below
    });
  }

  // Fill descendantCount per child: BFS sub-tree size using adj.
  // Re-run sub-BFS from each visited node (cheap, visited already bounded).
  for (const child of childrenOutput) {
    let count = 0;
    const subVisited = new Set<number>([child.thread.id]);
    const subQueue = [...(adj.get(child.thread.id) ?? []).map((e) => e.childId)];
    while (subQueue.length > 0) {
      const tid = subQueue.shift()!;
      if (subVisited.has(tid) || !visited.has(tid)) continue;
      subVisited.add(tid);
      count++;
      subQueue.push(...(adj.get(tid) ?? []).map((e) => e.childId));
    }
    child.descendantCount = count;
  }

  // Sort: depth asc, name asc, id asc
  childrenOutput.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const na = a.thread.name;
    const nb = b.thread.name;
    if (na < nb) return -1;
    if (na > nb) return 1;
    return a.thread.id - b.thread.id;
  });

  const directChildren = descendantNodes.filter((n) => n.depth === 1);

  return {
    direct: { progress: directProgress, energyHours: directEnergy },
    contains: {
      childCount: directChildren.length,
      descendantCount: descendantNodes.length,
      progress: { done: descDone, total: descTotal },
      energyHours: descEnergy,
      missingCost: null,
      missingCostStatus: "unavailable"
    },
    total: {
      progress: { done: directProgress.done + descDone, total: directProgress.total + descTotal },
      energyHours: directEnergy + descEnergy,
      missingCost: null,
      missingCostStatus: "unavailable"
    },
    children: childrenOutput,
    warnings
  };
}
