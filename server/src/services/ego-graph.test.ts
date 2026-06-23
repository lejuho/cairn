import { describe, expect, it } from "vitest";
import { buildEgoGraph, makeNodeId } from "./ego-graph.js";
import type { EgoGraphInput, RawEdge, RawNeighbor } from "./ego-graph.js";

function makeInput(overrides: Partial<EgoGraphInput> = {}): EgoGraphInput {
  return {
    centerType: "resource",
    centerId: 1,
    centerLabel: "노트북",
    neighbors: [],
    edges: [],
    limit: 10,
    ...overrides
  };
}

function neighbor(type: RawNeighbor["type"], id: number, label = `${type}:${id}`): RawNeighbor {
  return { type, targetId: id, label };
}

function edge(
  fromType: RawEdge["fromType"],
  fromId: number,
  toType: RawEdge["toType"],
  toId: number,
  kind: RawEdge["kind"] = "resource_link",
  firmness: RawEdge["firmness"] = "soft"
): RawEdge {
  return { fromType, fromId, toType, toId, kind, firmness };
}

describe("buildEgoGraph — basic structure", () => {
  it("center node appears first in nodes array", () => {
    const result = buildEgoGraph(makeInput({ neighbors: [neighbor("event", 10)] }));
    expect(result.nodes[0]!.id).toBe("resource:1");
  });

  it("center node id uses makeNodeId format", () => {
    expect(makeNodeId("resource", 3)).toBe("resource:3");
  });

  it("returns empty edges when no neighbors", () => {
    const result = buildEgoGraph(makeInput());
    expect(result.edges).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("nodes includes center + all neighbors when within limit", () => {
    const result = buildEgoGraph(makeInput({
      neighbors: [neighbor("event", 1), neighbor("task", 2)],
      limit: 5
    }));
    expect(result.nodes).toHaveLength(3); // center + 2
  });
});

describe("buildEgoGraph — cap and truncation", () => {
  it("caps nodes at limit and sets truncated=true", () => {
    const ns = Array.from({ length: 10 }, (_, i) => neighbor("event", i + 1));
    const result = buildEgoGraph(makeInput({ neighbors: ns, limit: 5 }));
    expect(result.nodes).toHaveLength(5); // center + 4 neighbors
    expect(result.truncated).toBe(true);
  });

  it("does not truncate when neighbors.length === limit-1", () => {
    const ns = Array.from({ length: 4 }, (_, i) => neighbor("event", i + 1));
    const result = buildEgoGraph(makeInput({ neighbors: ns, limit: 5 }));
    expect(result.nodes).toHaveLength(5);
    expect(result.truncated).toBe(false);
  });

  it("drops edges whose endpoints are truncated out", () => {
    const ns = Array.from({ length: 6 }, (_, i) => neighbor("event", i + 1));
    const edges: RawEdge[] = [
      edge("resource", 1, "event", 1), // kept
      edge("resource", 1, "event", 5), // truncated out
      edge("resource", 1, "event", 6)  // truncated out
    ];
    const result = buildEgoGraph(makeInput({ neighbors: ns, edges, limit: 5 }));
    expect(result.nodes).toHaveLength(5); // center + 4
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.to).toBe("event:1");
  });
});

describe("buildEgoGraph — deterministic ordering", () => {
  it("sorts neighbors by typeRank then targetId", () => {
    const ns = [
      neighbor("thread", 5),
      neighbor("event", 2),
      neighbor("person", 1),
      neighbor("task", 3),
      neighbor("event", 1)
    ];
    const result = buildEgoGraph(makeInput({ neighbors: ns, limit: 10 }));
    const ids = result.nodes.slice(1).map((n) => n.id);
    expect(ids).toEqual(["person:1", "event:1", "event:2", "task:3", "thread:5"]);
  });

  it("deduplicates neighbors with same type+id", () => {
    const ns = [neighbor("event", 1), neighbor("event", 1), neighbor("event", 2)];
    const result = buildEgoGraph(makeInput({ neighbors: ns, limit: 10 }));
    expect(result.nodes).toHaveLength(3); // center + event:1 + event:2
  });
});

describe("buildEgoGraph — edge properties", () => {
  it("preserves firmness", () => {
    const ns = [neighbor("event", 1)];
    const edges: RawEdge[] = [{ ...edge("resource", 1, "event", 1), firmness: "tentative" }];
    const result = buildEgoGraph(makeInput({ neighbors: ns, edges }));
    expect(result.edges[0]!.firmness).toBe("tentative");
  });

  it("preserves reason", () => {
    const ns = [neighbor("event", 1)];
    const edges: RawEdge[] = [{ ...edge("resource", 1, "event", 1), reason: "발표 때 필요" }];
    const result = buildEgoGraph(makeInput({ neighbors: ns, edges }));
    expect(result.edges[0]!.reason).toBe("발표 때 필요");
  });

  it("omits reason key when undefined", () => {
    const ns = [neighbor("event", 1)];
    const edges: RawEdge[] = [edge("resource", 1, "event", 1)];
    const result = buildEgoGraph(makeInput({ neighbors: ns, edges }));
    expect("reason" in result.edges[0]!).toBe(false);
  });

  it("preserves relationKind for thread_link edges", () => {
    const ns = [neighbor("thread", 5)];
    const edges: RawEdge[] = [{
      fromType: "resource", fromId: 1,
      toType: "thread", toId: 5,
      kind: "thread_link",
      firmness: "hard",
      relationKind: "contains"
    }];
    const result = buildEgoGraph(makeInput({ neighbors: ns, edges }));
    expect(result.edges[0]!.relationKind).toBe("contains");
  });
});
