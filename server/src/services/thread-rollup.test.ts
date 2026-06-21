import { describe, expect, it } from "vitest";
import { computeRollup } from "./thread-rollup.js";
import type { ContainsEdge, EventSlim, TaskSlim } from "../repositories/threads.js";

function makeInput(opts: {
  rootId?: number;
  edges?: ContainsEdge[];
  events?: EventSlim[];
  tasks?: TaskSlim[];
  names?: Record<number, string>;
}) {
  const rootId = opts.rootId ?? 1;
  const edges = opts.edges ?? [];
  const events = opts.events ?? [];
  const tasks = opts.tasks ?? [];
  const nameById = new Map<number, string>(Object.entries(opts.names ?? { 1: "Root" }).map(([k, v]) => [Number(k), v]));

  const eventsByThread = new Map<number, EventSlim[]>();
  for (const e of events) {
    const b = eventsByThread.get(e.threadId) ?? [];
    b.push(e);
    eventsByThread.set(e.threadId, b);
  }
  const tasksByThread = new Map<number, TaskSlim[]>();
  for (const t of tasks) {
    const b = tasksByThread.get(t.threadId) ?? [];
    b.push(t);
    tasksByThread.set(t.threadId, b);
  }

  return { rootId, edges, eventsByThread, tasksByThread, nameById };
}

describe("computeRollup — no children", () => {
  it("returns zero contains counts when no edges", () => {
    const r = computeRollup(makeInput({}));
    expect(r.contains.childCount).toBe(0);
    expect(r.contains.descendantCount).toBe(0);
    expect(r.children).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("direct progress from root events/tasks only", () => {
    const r = computeRollup(makeInput({
      events: [{ id: 1, threadId: 1, start: null, end: null, status: "done" }],
      tasks: [{ id: 2, threadId: 1, status: "todo" }]
    }));
    expect(r.direct.progress).toEqual({ done: 1, total: 2 });
    expect(r.contains.progress).toEqual({ done: 0, total: 0 });
    expect(r.total.progress).toEqual({ done: 1, total: 2 });
  });

  it("excludes cancelled and dropped from progress total", () => {
    const r = computeRollup(makeInput({
      events: [
        { id: 1, threadId: 1, start: null, end: null, status: "done" },
        { id: 2, threadId: 1, start: null, end: null, status: "cancelled" }
      ],
      tasks: [{ id: 3, threadId: 1, status: "dropped" }]
    }));
    expect(r.direct.progress).toEqual({ done: 1, total: 1 });
  });
});

describe("computeRollup — hard contains chain A→B→C", () => {
  const edges: ContainsEdge[] = [
    { relationId: 10, parentId: 1, childId: 2 },
    { relationId: 11, parentId: 2, childId: 3 }
  ];
  const names = { 1: "Root", 2: "Child", 3: "Grandchild" };

  it("includes B and C as descendants", () => {
    const r = computeRollup(makeInput({ edges, names }));
    expect(r.contains.descendantCount).toBe(2);
    expect(r.children).toHaveLength(2);
  });

  it("B at depth 1, C at depth 2", () => {
    const r = computeRollup(makeInput({ edges, names }));
    const [b, c] = r.children as [typeof r.children[0], typeof r.children[0]];
    expect(b.thread.id).toBe(2);
    expect(b.depth).toBe(1);
    expect(c.thread.id).toBe(3);
    expect(c.depth).toBe(2);
  });

  it("B has descendantCount 1 (C is beneath it)", () => {
    const r = computeRollup(makeInput({ edges, names }));
    const b = r.children.find((ch) => ch.thread.id === 2)!;
    expect(b.descendantCount).toBe(1);
  });

  it("C has descendantCount 0", () => {
    const r = computeRollup(makeInput({ edges, names }));
    const c = r.children.find((ch) => ch.thread.id === 3)!;
    expect(c.descendantCount).toBe(0);
  });

  it("aggregates descendant progress excluding root direct", () => {
    const r = computeRollup(makeInput({
      edges, names,
      events: [
        { id: 1, threadId: 1, start: null, end: null, status: "done" },  // direct
        { id: 2, threadId: 2, start: null, end: null, status: "planned" }, // child B
        { id: 3, threadId: 3, start: null, end: null, status: "done" }    // grandchild C
      ]
    }));
    expect(r.direct.progress).toEqual({ done: 1, total: 1 });
    expect(r.contains.progress).toEqual({ done: 1, total: 2 });
    expect(r.total.progress).toEqual({ done: 2, total: 3 });
  });
});

describe("computeRollup — cycle detection", () => {
  it("handles historical A→B→A cycle without infinite loop", () => {
    const edges: ContainsEdge[] = [
      { relationId: 10, parentId: 1, childId: 2 },
      { relationId: 11, parentId: 2, childId: 1 }  // cycle back to root
    ];
    const r = computeRollup(makeInput({ edges, names: { 1: "A", 2: "B" } }));
    // B visited once, the back-edge to root (seeded in visited) is skipped.
    expect(r.contains.descendantCount).toBe(1);
    expect(r.warnings).toContain("CONTAINS_CYCLE_DETECTED");
  });

  it("handles duplicate path without double-counting", () => {
    // A→B, A→C, B→C (C reachable via two paths)
    const edges: ContainsEdge[] = [
      { relationId: 10, parentId: 1, childId: 2 },
      { relationId: 11, parentId: 1, childId: 3 },
      { relationId: 12, parentId: 2, childId: 3 }
    ];
    const r = computeRollup(makeInput({ edges, names: { 1: "A", 2: "B", 3: "C" } }));
    expect(r.contains.descendantCount).toBe(2); // B and C, C counted once
    expect(r.warnings).toContain("CONTAINS_CYCLE_DETECTED");
  });
});

describe("computeRollup — sorting", () => {
  it("sorts children by depth, then name, then id", () => {
    const edges: ContainsEdge[] = [
      { relationId: 10, parentId: 1, childId: 3 },
      { relationId: 11, parentId: 1, childId: 2 }
    ];
    const r = computeRollup(makeInput({ edges, names: { 1: "Root", 2: "Alpha", 3: "Beta" } }));
    expect(r.children[0]!.thread.name).toBe("Alpha"); // id 2 name Alpha < Beta
    expect(r.children[1]!.thread.name).toBe("Beta");
  });
});

describe("computeRollup — energy hours", () => {
  it("sums valid event durations in hours", () => {
    const r = computeRollup(makeInput({
      events: [
        { id: 1, threadId: 1, start: "2026-06-21T09:00:00+09:00", end: "2026-06-21T11:00:00+09:00", status: "done" }
      ]
    }));
    expect(r.direct.energyHours).toBeCloseTo(2, 5);
  });

  it("ignores events with null start or end", () => {
    const r = computeRollup(makeInput({
      events: [
        { id: 1, threadId: 1, start: null, end: "2026-06-21T11:00:00+09:00", status: "done" },
        { id: 2, threadId: 1, start: "2026-06-21T09:00:00+09:00", end: null, status: "done" }
      ]
    }));
    expect(r.direct.energyHours).toBe(0);
  });

  it("clamps negative duration to 0", () => {
    const r = computeRollup(makeInput({
      events: [
        { id: 1, threadId: 1, start: "2026-06-21T11:00:00+09:00", end: "2026-06-21T09:00:00+09:00", status: "done" }
      ]
    }));
    expect(r.direct.energyHours).toBe(0);
  });

  it("excludes soft/non-contains edges — only hard contains tested via edges param", () => {
    // makeInput only accepts edges that the caller provides; service doesn't filter by firmness here
    // because the repo already filters. This test confirms the path when edges is empty.
    const r = computeRollup(makeInput({ edges: [], events: [{ id: 1, threadId: 2, start: "2026-06-21T10:00:00Z", end: "2026-06-21T11:00:00Z", status: "done" }] }));
    // thread 2 not in descendants → its event not in contains energy
    expect(r.contains.energyHours).toBe(0);
  });
});
