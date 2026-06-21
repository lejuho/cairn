// Pure graph invariant functions — no DB access, fully testable.

/**
 * Checks if adding a `contains` edge (fromThreadId → toThreadId) would create
 * a cycle, given the full adjacency map of existing contains edges.
 * Traverses downward from toThreadId; if fromThreadId is reachable, adding
 * the edge creates a cycle.
 */
export function wouldCreateContainsCycle(
  fromThreadId: number,
  toThreadId: number,
  adjacency: Map<number, number[]>
): boolean {
  const visited = new Set<number>();
  const stack = [toThreadId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromThreadId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const children = adjacency.get(current) ?? [];
    for (const child of children) {
      stack.push(child);
    }
  }
  return false;
}
