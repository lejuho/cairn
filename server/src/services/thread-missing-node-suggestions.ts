import type {
  ThreadMissingNodeSampleThread,
  ThreadMissingNodeSuggestion,
  ThreadMissingNodeSuggestionReasonCode,
  ThreadRow
} from "@cairn/shared";

// Missing Node Suggestions A (cycle-54 FR-THR-08). Pure deterministic — no DB,
// LLM, time, randomness, or mutation. Suggests node titles found among `done`
// direct nodes of OTHER completed same-kind threads that the current thread
// lacks. Standalone titles only — never copies dates, ordering, or dependencies.

export type NodeTitleInput = { threadId: number; title: string | null; status: string | null };
export type CurrentNodeInput = { title: string | null };

const SUGGESTION_LIMIT = 5;
const SAMPLE_LIMIT = 3;

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

type Group = {
  nodeKind: "event" | "task";
  normTitle: string;
  displayTitle: string;
  threadIds: Set<number>; // distinct contributing thread ids (per-thread collapse)
};

function buildGroups(
  nodeKind: "event" | "task",
  nodes: NodeTitleInput[]
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const n of nodes) {
    if (n.status !== "done" || n.title == null) continue;
    const trimmed = n.title.trim();
    if (trimmed === "") continue;
    const normTitle = normalizeTitle(trimmed);
    let g = groups.get(normTitle);
    if (!g) {
      // nodes arrive ordered by (threadId via grouping) then node id asc, so the
      // first seen as-written title is the deterministic display title.
      g = { nodeKind, normTitle, displayTitle: trimmed, threadIds: new Set() };
      groups.set(normTitle, g);
    }
    g.threadIds.add(n.threadId);
  }
  return groups;
}

export function computeThreadMissingNodeSuggestions(
  currentThread: ThreadRow,
  currentEvents: CurrentNodeInput[],
  currentTasks: CurrentNodeInput[],
  evidenceThreads: ThreadRow[],
  evidenceEvents: NodeTitleInput[],
  evidenceTasks: NodeTitleInput[]
): ThreadMissingNodeSuggestion[] {
  const kind = currentThread.kind?.trim();
  if (!kind) return [];
  if (currentThread.status === "done" || currentThread.status === "dropped") return [];

  // Suppress any title (normalized) the current thread already has on a direct
  // event OR task — regardless of node kind.
  const suppress = new Set<string>();
  for (const n of [...currentEvents, ...currentTasks]) {
    if (n.title == null) continue;
    const t = n.title.trim();
    if (t !== "") suppress.add(normalizeTitle(t));
  }

  const nameById = new Map(evidenceThreads.map((t) => [t.id, t.name]));

  const suggestions: ThreadMissingNodeSuggestion[] = [];
  const kinds: { nodeKind: "event" | "task"; nodes: NodeTitleInput[] }[] = [
    { nodeKind: "event", nodes: evidenceEvents },
    { nodeKind: "task", nodes: evidenceTasks }
  ];

  for (const { nodeKind, nodes } of kinds) {
    const groups = buildGroups(nodeKind, nodes);
    for (const g of groups.values()) {
      if (suppress.has(g.normTitle)) continue;
      const threadIds = [...g.threadIds].sort((a, b) => a - b);
      const evidenceThreadCount = threadIds.length;
      const evidenceNodeCount = evidenceThreadCount; // per-thread collapse → 1 each
      const sampleThreads: ThreadMissingNodeSampleThread[] = threadIds
        .slice(0, SAMPLE_LIMIT)
        .map((id) => ({ id, name: nameById.get(id) ?? "" }));

      const reasonCodes: ThreadMissingNodeSuggestionReasonCode[] = [
        "missing_same_kind_completed_thread",
        "missing_absent_from_current_thread"
      ];
      if (evidenceThreadCount >= 2) reasonCodes.push("missing_repeated_evidence");

      suggestions.push({
        id: `missing-node:${nodeKind}:${g.normTitle}`,
        nodeKind,
        title: g.displayTitle,
        firmness: "soft",
        source: "inferred",
        evidenceThreadCount,
        evidenceNodeCount,
        sampleThreads,
        reasonCodes
      });
    }
  }

  suggestions.sort((a, b) => {
    if (a.evidenceThreadCount !== b.evidenceThreadCount) return b.evidenceThreadCount - a.evidenceThreadCount;
    if (a.evidenceNodeCount !== b.evidenceNodeCount) return b.evidenceNodeCount - a.evidenceNodeCount;
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return a.nodeKind < b.nodeKind ? -1 : a.nodeKind > b.nodeKind ? 1 : 0;
  });

  return suggestions.slice(0, SUGGESTION_LIMIT);
}
