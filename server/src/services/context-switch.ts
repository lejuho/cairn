import type {
  EventRow,
  TransitionCost,
  TransitionFirmness,
  TransitionRelationKind
} from "@cairn/shared";

// A thread_links row scoped to the day's threads (either direction).
export type ThreadLinkRow = {
  id: number;
  fromThread: number;
  toThread: number;
  kind: TransitionRelationKind;
  firmness: TransitionFirmness;
};

// Context-sharing kinds reduce switch cost; non-context kinds are known
// relations that do NOT reduce it (plan FR-FEAS-08 A-slice).
const CONTEXT_KINDS: ReadonlySet<TransitionRelationKind> = new Set(["contains", "shares", "feeds"]);

// Deterministic kind ordering within a class (plan Sprint Contract).
const KIND_ORDER: Record<TransitionRelationKind, number> = {
  contains: 0,
  shares: 1,
  feeds: 2,
  blocks: 3,
  competes: 4
};
const FIRMNESS_ORDER: Record<TransitionFirmness, number> = { hard: 0, soft: 1 };

function isContext(kind: TransitionRelationKind): boolean {
  return CONTEXT_KINDS.has(kind);
}

// Pick the winning link between two threads. Context class wins over
// non-context class; within a class use kind order, then firmness, then id.
function pickWinningLink(links: ThreadLinkRow[]): ThreadLinkRow {
  return [...links].sort((a, b) => {
    const classA = isContext(a.kind) ? 0 : 1;
    const classB = isContext(b.kind) ? 0 : 1;
    if (classA !== classB) return classA - classB;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (FIRMNESS_ORDER[a.firmness] !== FIRMNESS_ORDER[b.firmness]) {
      return FIRMNESS_ORDER[a.firmness] - FIRMNESS_ORDER[b.firmness];
    }
    return a.id - b.id;
  })[0]!;
}

function linksBetween(relations: ThreadLinkRow[], t1: number, t2: number): ThreadLinkRow[] {
  return relations.filter(
    (r) =>
      (r.fromThread === t1 && r.toThread === t2) ||
      (r.fromThread === t2 && r.toThread === t1)
  );
}

// Pure: given already-sorted scheduled events and the thread_links among the
// day's threads, return one TransitionCost per consecutive pair. No mutation,
// no LLM, no schedule reorder.
export function computeTransitionCosts(
  scheduled: EventRow[],
  relations: ThreadLinkRow[]
): TransitionCost[] {
  const out: TransitionCost[] = [];

  for (let i = 0; i < scheduled.length - 1; i++) {
    const from = scheduled[i]!;
    const to = scheduled[i + 1]!;
    const fromThreadId = from.threadId ?? null;
    const toThreadId = to.threadId ?? null;

    const base = {
      fromEventId: from.id,
      toEventId: to.id,
      fromThreadId,
      toThreadId
    };

    if (fromThreadId == null || toThreadId == null) {
      out.push({
        ...base,
        relation: "missing_thread",
        costLevel: "unknown",
        reasonCodes: ["transition_missing_thread"]
      });
      continue;
    }

    if (fromThreadId === toThreadId) {
      out.push({
        ...base,
        relation: "same_thread",
        costLevel: "none",
        reasonCodes: ["transition_same_thread"]
      });
      continue;
    }

    const links = linksBetween(relations, fromThreadId, toThreadId);
    if (links.length === 0) {
      out.push({
        ...base,
        relation: "unrelated",
        costLevel: "high",
        reasonCodes: ["transition_unrelated"]
      });
      continue;
    }

    const winner = pickWinningLink(links);
    if (isContext(winner.kind)) {
      out.push({
        ...base,
        relation: "context_link",
        relationKind: winner.kind,
        firmness: winner.firmness,
        costLevel: "low",
        reasonCodes: ["transition_context_link"]
      });
    } else {
      out.push({
        ...base,
        relation: "non_context_link",
        relationKind: winner.kind,
        firmness: winner.firmness,
        costLevel: "high",
        reasonCodes: ["transition_non_context_link"]
      });
    }
  }

  return out;
}
