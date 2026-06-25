import type {
  EventRow,
  SequenceOrder,
  SequenceOrderDependencyKind,
  SequenceOrderEdge,
  SequenceOrderFirmness,
  TransitionCostLevel
} from "@cairn/shared";
import { computeTransitionCosts, type ThreadLinkRow } from "./context-switch.js";

// A raw event-event dependency link (kind limited to requires|blocks) loaded by
// the repository. May reference an event outside the current day; the service
// only forms an edge when both endpoints are day-scheduled events.
export type DependencyLinkRow = {
  fromId: number;
  toId: number;
  kind: SequenceOrderDependencyKind;
  firmness: SequenceOrderFirmness;
};

const TRANSITION_RANK: Record<TransitionCostLevel, number> = {
  none: 0,
  low: 1,
  high: 2,
  unknown: 3
};

function durationMinutes(e: EventRow): number {
  if (e.start == null || e.end == null) return 0;
  const start = Date.parse(e.start);
  const end = Date.parse(e.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return (end - start) / (1000 * 60);
}

// Normalize a dependency link into a "must come before" directed edge:
//   `A requires B` → B before A → edge {from: B, to: A}
//   `A blocks B`   → A before B → edge {from: A, to: B}
function toBeforeEdge(link: DependencyLinkRow): SequenceOrderEdge {
  if (link.kind === "requires") {
    return { from: link.toId, to: link.fromId, kind: "requires", firmness: link.firmness };
  }
  return { from: link.fromId, to: link.toId, kind: "blocks", firmness: link.firmness };
}

// Pure deterministic sequence-ordering diagnostics (FR-FEAS-10 A-slice). No DB,
// LLM, external, or mutation. `scheduled` must already be in the day's
// deterministic scheduled order (start asc). Hard before-edges constrain the
// candidate topological order; soft/tentative edges are evidence only.
export function computeSequenceOrder(
  scheduled: EventRow[],
  dependencyLinks: DependencyLinkRow[],
  relations: ThreadLinkRow[]
): SequenceOrder {
  const currentOrder = scheduled.map((e) => e.id);
  const daySet = new Set(currentOrder);
  const rank = new Map(currentOrder.map((id, i) => [id, i]));
  const eventById = new Map(scheduled.map((e) => [e.id, e]));

  const reasonCodes: string[] = [];

  const hardEdges: SequenceOrderEdge[] = [];
  const softEdges: SequenceOrderEdge[] = [];
  let outOfScope = false;
  for (const link of dependencyLinks) {
    const bothInDay = daySet.has(link.fromId) && daySet.has(link.toId);
    const oneInDay = daySet.has(link.fromId) || daySet.has(link.toId);
    if (!bothInDay) {
      if (oneInDay) outOfScope = true; // dependency leaves the day scope
      continue;
    }
    const edge = toBeforeEdge(link);
    if (edge.firmness === "hard") hardEdges.push(edge);
    else softEdges.push(edge);
  }
  if (outOfScope) reasonCodes.push("sequence_order_out_of_scope_dependency");

  // Current-order violations: a hard before-edge whose `from` is scheduled after
  // its `to`.
  const violations = hardEdges
    .filter((e) => (rank.get(e.from) ?? -1) > (rank.get(e.to) ?? -1))
    .map((e) => ({ from: e.from, to: e.to, kind: e.kind }));

  // Build the hard dependency adjacency + indegree over day events.
  const adj = new Map<number, number[]>(currentOrder.map((id) => [id, []]));
  const indegree = new Map<number, number>(currentOrder.map((id) => [id, 0]));
  for (const e of hardEdges) {
    adj.get(e.from)!.push(e.to);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  const { candidateOrder, parallelGroups, cycleDetected } = topoOrder(
    currentOrder,
    adj,
    indegree,
    rank,
    eventById,
    relations
  );

  let finalCandidate = candidateOrder;
  let finalGroups = parallelGroups;
  let criticalPath: number[] = [];
  if (cycleDetected) {
    finalCandidate = [...currentOrder];
    finalGroups = [];
    reasonCodes.push("sequence_order_cycle_detected");
  } else {
    criticalPath = longestPath(currentOrder, adj, rank, eventById);
  }

  const orderChanged =
    finalCandidate.length !== currentOrder.length ||
    finalCandidate.some((id, i) => id !== currentOrder[i]);

  if (hardEdges.length > 0 || softEdges.length > 0) reasonCodes.push("sequence_order_has_dependencies");
  if (violations.length > 0) reasonCodes.push("sequence_order_violations_present");
  if (!cycleDetected && orderChanged) reasonCodes.push("sequence_order_changed");

  return {
    scope: "day_scheduled_events",
    currentOrder,
    candidateOrder: finalCandidate,
    orderChanged,
    hardEdges,
    softEdges,
    violations,
    parallelGroups: finalGroups,
    criticalPath,
    cycleDetected,
    reasonCodes
  };
}

function transitionRankFrom(
  prevId: number | null,
  candidateId: number,
  eventById: Map<number, EventRow>,
  relations: ThreadLinkRow[]
): number {
  if (prevId == null) return 0;
  const prev = eventById.get(prevId);
  const cand = eventById.get(candidateId);
  if (!prev || !cand) return TRANSITION_RANK.unknown;
  // Reuse the existing transition-cost model (no new model) for the prev→cand
  // pair only.
  const cost = computeTransitionCosts([prev, cand], relations)[0];
  return TRANSITION_RANK[cost?.costLevel ?? "unknown"];
}

// Kahn topological order. parallelGroups are the ready layers BEFORE the
// transition tie-break; candidateOrder applies the tie-break within each step.
function topoOrder(
  nodes: number[],
  adj: Map<number, number[]>,
  indegreeInit: Map<number, number>,
  rank: Map<number, number>,
  eventById: Map<number, EventRow>,
  relations: ThreadLinkRow[]
): { candidateOrder: number[]; parallelGroups: { eventIds: number[] }[]; cycleDetected: boolean } {
  const indegree = new Map(indegreeInit);

  // Parallel groups: standard Kahn layer decomposition.
  const parallelGroups: { eventIds: number[] }[] = [];
  {
    const ind = new Map(indegreeInit);
    let ready = nodes.filter((n) => (ind.get(n) ?? 0) === 0).sort(byRankThenId(rank));
    let processed = 0;
    while (ready.length > 0) {
      parallelGroups.push({ eventIds: [...ready] });
      const next: number[] = [];
      for (const n of ready) {
        processed++;
        for (const m of adj.get(n) ?? []) {
          ind.set(m, (ind.get(m) ?? 0) - 1);
          if (ind.get(m) === 0) next.push(m);
        }
      }
      ready = next.sort(byRankThenId(rank));
    }
    if (processed < nodes.length) {
      return { candidateOrder: [...nodes], parallelGroups: [], cycleDetected: true };
    }
  }

  // Candidate order: one node at a time, tie-broken by transition cost from the
  // previously chosen event, then current rank, then id. `ready` is an array of
  // currently-ready nodes; the chosen node is filtered out each step.
  const candidateOrder: number[] = [];
  let ready = nodes.filter((n) => (indegree.get(n) ?? 0) === 0);
  let prev: number | null = null;
  while (ready.length > 0) {
    const choice = [...ready].sort((a, b) => {
      const ta = transitionRankFrom(prev, a, eventById, relations);
      const tb = transitionRankFrom(prev, b, eventById, relations);
      if (ta !== tb) return ta - tb;
      return byRankThenId(rank)(a, b);
    })[0]!;
    candidateOrder.push(choice);
    ready = ready.filter((n) => n !== choice);
    prev = choice;
    for (const m of adj.get(choice) ?? []) {
      indegree.set(m, (indegree.get(m) ?? 0) - 1);
      if (indegree.get(m) === 0) ready.push(m);
    }
  }

  return { candidateOrder, parallelGroups, cycleDetected: false };
}

function byRankThenId(rank: Map<number, number>) {
  return (a: number, b: number): number => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a - b;
  };
}

// Longest hard-dependency path weighted by event duration minutes (invalid → 0),
// in the acyclic graph. Deterministic tie-break by rank then id for both the
// predecessor choice and the endpoint choice. Returns the node-id sequence.
function longestPath(
  nodes: number[],
  adj: Map<number, number[]>,
  rank: Map<number, number>,
  eventById: Map<number, EventRow>
): number[] {
  // Process nodes in a stable topological order (recompute via Kahn with
  // rank/id ordering); graph is known acyclic here.
  const order: number[] = [];
  {
    const ind = new Map<number, number>(nodes.map((n) => [n, 0]));
    for (const [, outs] of adj) for (const m of outs) ind.set(m, (ind.get(m) ?? 0) + 1);
    let ready = nodes.filter((n) => (ind.get(n) ?? 0) === 0).sort(byRankThenId(rank));
    while (ready.length > 0) {
      const next: number[] = [];
      for (const n of ready) {
        order.push(n);
        for (const m of adj.get(n) ?? []) {
          ind.set(m, (ind.get(m) ?? 0) - 1);
          if (ind.get(m) === 0) next.push(m);
        }
      }
      ready = next.sort(byRankThenId(rank));
    }
  }

  const weight = new Map(nodes.map((n) => [n, durationMinutes(eventById.get(n)!)]));
  const dist = new Map<number, number>(nodes.map((n) => [n, weight.get(n) ?? 0]));
  const parent = new Map<number, number | null>(nodes.map((n) => [n, null]));

  const cmp = byRankThenId(rank);
  for (const u of order) {
    for (const v of adj.get(u) ?? []) {
      const cand = (dist.get(u) ?? 0) + (weight.get(v) ?? 0);
      const cur = dist.get(v) ?? 0;
      if (cand > cur) {
        // Strictly longer path by duration.
        dist.set(v, cand);
        parent.set(v, u);
      } else if (cand === cur) {
        // Equal length: still record a predecessor so a real hard edge surfaces
        // even when the upstream event has 0/invalid duration. Keep the
        // deterministic predecessor (lower current rank, then id).
        const prevParent = parent.get(v);
        if (prevParent == null || cmp(u, prevParent) < 0) parent.set(v, u);
      }
    }
  }

  if (nodes.length === 0) return [];
  // Endpoint = max dist, tie-break by rank then id.
  const end = [...nodes].sort((a, b) => {
    const da = dist.get(a) ?? 0;
    const db = dist.get(b) ?? 0;
    if (da !== db) return db - da;
    return cmp(a, b);
  })[0]!;

  const path: number[] = [];
  let cur: number | null = end;
  while (cur != null) {
    path.push(cur);
    cur = parent.get(cur) ?? null;
  }
  path.reverse();
  // A single node with no edges has a trivial one-node "path"; only surface a
  // critical path when at least one hard edge participates.
  if (path.length <= 1) return [];
  return path;
}
