import { describe, expect, it } from "vitest";
import { wouldCreateContainsCycle } from "./thread-links.js";

function adj(edges: [number, number][]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const [from, to] of edges) {
    const children = map.get(from) ?? [];
    children.push(to);
    map.set(from, children);
  }
  return map;
}

describe("wouldCreateContainsCycle", () => {
  it("empty graph: no cycle", () => {
    expect(wouldCreateContainsCycle(1, 2, adj([]))).toBe(false);
  });

  it("direct reverse: A→B exists, adding B→A is a cycle", () => {
    expect(wouldCreateContainsCycle(2, 1, adj([[1, 2]]))).toBe(true);
  });

  it("chain A→B→C: adding C→A is a cycle", () => {
    expect(wouldCreateContainsCycle(3, 1, adj([[1, 2], [2, 3]]))).toBe(true);
  });

  it("chain A→B→C: adding A→D is not a cycle", () => {
    expect(wouldCreateContainsCycle(1, 4, adj([[1, 2], [2, 3]]))).toBe(false);
  });

  it("unrelated branch: C→D exists, adding A→B is not a cycle", () => {
    expect(wouldCreateContainsCycle(1, 2, adj([[3, 4]]))).toBe(false);
  });

  it("diamond A→B, A→C, B→D, C→D — adding D→A is a cycle", () => {
    expect(wouldCreateContainsCycle(4, 1, adj([[1, 2], [1, 3], [2, 4], [3, 4]]))).toBe(true);
  });

  it("diamond A→B, A→C, B→D, C→D — adding D→E is not a cycle", () => {
    expect(wouldCreateContainsCycle(4, 5, adj([[1, 2], [1, 3], [2, 4], [3, 4]]))).toBe(false);
  });

  it("self-link: fromThread === toThread is not handled here (route guards it)", () => {
    // A self-link: from=1, to=1, adjacency has 1→2. Starting DFS from 1, first we check 1===1, returns true.
    expect(wouldCreateContainsCycle(1, 1, adj([[1, 2]]))).toBe(true);
  });
});
