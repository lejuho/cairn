import type {
  EgoGraphData,
  EgoGraphEdge,
  EgoGraphFirmness,
  EgoGraphNode,
  EgoGraphNodeType
} from "@cairn/shared";

// Type rank for deterministic neighbor ordering (lower = kept first).
const TYPE_RANK: Record<EgoGraphNodeType, number> = {
  person: 0,
  resource: 1,
  event: 2,
  task: 3,
  thread: 4
};

export function makeNodeId(type: EgoGraphNodeType, targetId: number): string {
  return `${type}:${targetId}`;
}

export type RawNeighbor = {
  type: EgoGraphNodeType;
  targetId: number;
  label: string;
  sublabel?: string;
  href?: string;
};

export type RawEdge = {
  fromType: EgoGraphNodeType;
  fromId: number;
  toType: EgoGraphNodeType;
  toId: number;
  kind: EgoGraphEdge["kind"];
  firmness: EgoGraphFirmness;
  reason?: string;
  relationKind?: EgoGraphEdge["relationKind"];
};

export type EgoGraphInput = {
  centerType: EgoGraphNodeType;
  centerId: number;
  centerLabel: string;
  centerHref?: string;
  neighbors: RawNeighbor[];
  edges: RawEdge[];
  limit: number;
};

export function buildEgoGraph(input: EgoGraphInput): EgoGraphData {
  const { centerType, centerId, centerLabel, centerHref, neighbors, edges, limit } = input;

  const center: EgoGraphNode = {
    id: makeNodeId(centerType, centerId),
    type: centerType,
    targetId: centerId,
    label: centerLabel,
    ...(centerHref ? { href: centerHref } : {})
  };

  // Deduplicate neighbors (same type+id from different edge sources).
  const neighborMap = new Map<string, RawNeighbor>();
  for (const n of neighbors) {
    const key = makeNodeId(n.type, n.targetId);
    if (!neighborMap.has(key)) {
      neighborMap.set(key, n);
    }
  }

  // Sort: (typeRank asc, targetId asc).
  const sorted = [...neighborMap.values()].sort((a, b) => {
    const rankDiff = TYPE_RANK[a.type] - TYPE_RANK[b.type];
    if (rankDiff !== 0) return rankDiff;
    return a.targetId - b.targetId;
  });

  // Cap to limit-1 (center takes one slot).
  const cap = Math.max(0, limit - 1);
  const kept = sorted.slice(0, cap);
  const truncated = sorted.length > cap;

  // Build kept node set.
  const keptIds = new Set<string>([center.id]);
  const keptNodes: EgoGraphNode[] = [center];
  for (const n of kept) {
    const node: EgoGraphNode = {
      id: makeNodeId(n.type, n.targetId),
      type: n.type,
      targetId: n.targetId,
      label: n.label,
      ...(n.sublabel ? { sublabel: n.sublabel } : {}),
      ...(n.href ? { href: n.href } : {})
    };
    keptIds.add(node.id);
    keptNodes.push(node);
  }

  // Filter edges: both endpoints must be in the kept set.
  const keptEdges: EgoGraphEdge[] = [];
  for (const e of edges) {
    const fromId = makeNodeId(e.fromType, e.fromId);
    const toId = makeNodeId(e.toType, e.toId);
    if (!keptIds.has(fromId) || !keptIds.has(toId)) continue;
    const edge: EgoGraphEdge = {
      from: fromId,
      to: toId,
      kind: e.kind,
      firmness: e.firmness,
      ...(e.reason ? { reason: e.reason } : {}),
      ...(e.relationKind ? { relationKind: e.relationKind } : {})
    };
    keptEdges.push(edge);
  }

  return {
    center,
    nodes: keptNodes,
    edges: keptEdges,
    truncated
  };
}
