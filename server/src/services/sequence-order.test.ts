import { describe, expect, it } from "vitest";
import type { EventRow } from "@cairn/shared";
import { computeSequenceOrder, type DependencyLinkRow } from "./sequence-order.js";
import type { ThreadLinkRow } from "./context-switch.js";

const D = "2026-06-22";
// Helper: event with id, threadId, and an hour-offset start so scheduled order
// follows id by default (id 1 earliest). durationMin sets the end.
function ev(id: number, hour: number, durationMin = 60, threadId: number | null = id): EventRow {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${D}T${pad(hour)}:00:00+09:00`;
  const endH = hour + Math.floor(durationMin / 60);
  const endM = durationMin % 60;
  const end = `${D}T${pad(endH)}:${pad(endM)}:00+09:00`;
  return {
    id, threadId, title: `E${id}`, type: null, start, end, location: null,
    mode: null, source: "cairn", selfImposed: 1, status: "planned", createdAt: null, updatedAt: null
  };
}

function link(fromId: number, toId: number, kind: "requires" | "blocks", firmness: "hard" | "soft" | "tentative" = "hard"): DependencyLinkRow {
  return { fromId, toId, kind, firmness };
}

const NO_REL: ThreadLinkRow[] = [];

describe("computeSequenceOrder — quiet", () => {
  it("no events → quiet empty order", () => {
    const o = computeSequenceOrder([], [], NO_REL);
    expect(o).toMatchObject({
      scope: "day_scheduled_events", currentOrder: [], candidateOrder: [], orderChanged: false,
      hardEdges: [], softEdges: [], violations: [], parallelGroups: [], criticalPath: [],
      cycleDetected: false
    });
    expect(o.reasonCodes).toEqual([]);
  });

  it("no dependency links → candidate equals current order", () => {
    const o = computeSequenceOrder([ev(1, 9), ev(2, 10), ev(3, 11)], [], NO_REL);
    expect(o.currentOrder).toEqual([1, 2, 3]);
    expect(o.candidateOrder).toEqual([1, 2, 3]);
    expect(o.orderChanged).toBe(false);
    expect(o.reasonCodes).not.toContain("sequence_order_changed");
  });
});

describe("computeSequenceOrder — edge direction + violations", () => {
  it("A requires B yields edge B->A and reports a violation when current order is A,B", () => {
    // current order [1,2] (A=1 at 9h, B=2 at 10h). 1 requires 2 → 2 must precede 1.
    const o = computeSequenceOrder([ev(1, 9), ev(2, 10)], [link(1, 2, "requires")], NO_REL);
    expect(o.hardEdges).toEqual([{ from: 2, to: 1, kind: "requires", firmness: "hard" }]);
    expect(o.violations).toEqual([{ from: 2, to: 1, kind: "requires" }]);
    expect(o.candidateOrder).toEqual([2, 1]);
    expect(o.orderChanged).toBe(true);
    expect(o.reasonCodes).toContain("sequence_order_violations_present");
    expect(o.reasonCodes).toContain("sequence_order_changed");
  });

  it("A blocks B yields edge A->B (no violation when already in order)", () => {
    const o = computeSequenceOrder([ev(1, 9), ev(2, 10)], [link(1, 2, "blocks")], NO_REL);
    expect(o.hardEdges).toEqual([{ from: 1, to: 2, kind: "blocks", firmness: "hard" }]);
    expect(o.violations).toEqual([]);
    expect(o.candidateOrder).toEqual([1, 2]);
    expect(o.orderChanged).toBe(false);
  });
});

describe("computeSequenceOrder — soft/tentative edges are evidence only", () => {
  it("a soft requires edge appears in softEdges but does not reorder", () => {
    const o = computeSequenceOrder([ev(1, 9), ev(2, 10)], [link(1, 2, "requires", "soft")], NO_REL);
    expect(o.softEdges).toEqual([{ from: 2, to: 1, kind: "requires", firmness: "soft" }]);
    expect(o.hardEdges).toEqual([]);
    expect(o.candidateOrder).toEqual([1, 2]); // soft does not force reorder
    expect(o.violations).toEqual([]); // only hard edges violate
  });

  it("a tentative edge also stays evidence-only", () => {
    const o = computeSequenceOrder([ev(1, 9), ev(2, 10)], [link(1, 2, "requires", "tentative")], NO_REL);
    expect(o.softEdges[0]!.firmness).toBe("tentative");
    expect(o.candidateOrder).toEqual([1, 2]);
  });
});

describe("computeSequenceOrder — tie-break", () => {
  it("multiple ready nodes use current rank then id when no transitions apply", () => {
    // 2 and 3 both depend on 1 (1 blocks 2, 1 blocks 3). After 1, ready={2,3};
    // no thread relations → transition unknown for both → rank then id → 2 then 3.
    const o = computeSequenceOrder(
      [ev(1, 9), ev(2, 10), ev(3, 11)],
      [link(1, 2, "blocks"), link(1, 3, "blocks")],
      NO_REL
    );
    expect(o.candidateOrder).toEqual([1, 2, 3]);
    expect(o.parallelGroups).toEqual([{ eventIds: [1] }, { eventIds: [2, 3] }]);
  });

  it("lower transition cost from the previous event wins the tie-break", () => {
    // 1 blocks 2, 1 blocks 3. Events 1 and 3 share thread 10 (same_thread=none);
    // event 2 is thread 20 (unrelated=high). After picking 1 (thread 10), the
    // tie-break prefers 3 (none) over 2 (high) despite 2's lower id.
    const a = ev(1, 9, 60, 10);
    const b = ev(2, 10, 60, 20);
    const c = ev(3, 11, 60, 10);
    const o = computeSequenceOrder([a, b, c], [link(1, 2, "blocks"), link(1, 3, "blocks")], NO_REL);
    expect(o.candidateOrder).toEqual([1, 3, 2]);
  });
});

describe("computeSequenceOrder — cycle", () => {
  it("a hard cycle sets cycleDetected and keeps candidate = current order", () => {
    // 1 blocks 2 (1->2) and 2 blocks 1 (2->1) → cycle.
    const o = computeSequenceOrder(
      [ev(1, 9), ev(2, 10)],
      [link(1, 2, "blocks"), link(2, 1, "blocks")],
      NO_REL
    );
    expect(o.cycleDetected).toBe(true);
    expect(o.candidateOrder).toEqual([1, 2]); // current order
    expect(o.criticalPath).toEqual([]);
    expect(o.parallelGroups).toEqual([]);
    expect(o.reasonCodes).toContain("sequence_order_cycle_detected");
  });
});

describe("computeSequenceOrder — critical path", () => {
  it("chooses the longest known-duration hard-dependency path", () => {
    // chain 1->2->3 durations 30/120/30 vs side 1->4 duration 200.
    // path 1,2,3 weight = 30+120+30 = 180; path 1,4 weight = 30+200 = 230 → 1,4.
    const e1 = ev(1, 9, 30);
    const e2 = ev(2, 10, 120);
    const e3 = ev(3, 12, 30);
    const e4 = ev(4, 13, 200);
    const o = computeSequenceOrder(
      [e1, e2, e3, e4],
      [link(1, 2, "blocks"), link(2, 3, "blocks"), link(1, 4, "blocks")],
      NO_REL
    );
    expect(o.criticalPath).toEqual([1, 4]);
  });

  it("surfaces a hard-dependency path even when the upstream event has 0/invalid duration", () => {
    // A(0-duration via invalid end) blocks B(60). The path [A,B] must still
    // surface as dependency evidence, not collapse to a single node.
    const a: EventRow = { ...ev(1, 9, 60), end: "2026-06-22T09:00:00+09:00" }; // end==start → 0
    const b = ev(2, 10, 60);
    const o = computeSequenceOrder([a, b], [link(1, 2, "blocks")], NO_REL);
    expect(o.criticalPath).toEqual([1, 2]);
  });

  it("invalid event duration counts as 0 for critical-path weight", () => {
    // e2 has end<=start (invalid) → weight 0. chain 1->2->3: 60 + 0 + 60 = 120;
    // side 1->4 weight 60+90=150 → critical path 1,4.
    const e1 = ev(1, 9, 60);
    const e2: EventRow = { ...ev(2, 10, 60), end: "2026-06-22T09:00:00+09:00" }; // end before start
    const e3 = ev(3, 11, 60);
    const e4 = ev(4, 12, 90);
    const o = computeSequenceOrder(
      [e1, e2, e3, e4],
      [link(1, 2, "blocks"), link(2, 3, "blocks"), link(1, 4, "blocks")],
      NO_REL
    );
    expect(o.criticalPath).toEqual([1, 4]);
  });
});

describe("computeSequenceOrder — out-of-scope dependency", () => {
  it("a dependency to an event outside the day is flagged but forms no edge", () => {
    // link references event 99 not in the day set.
    const o = computeSequenceOrder([ev(1, 9), ev(2, 10)], [link(1, 99, "blocks")], NO_REL);
    expect(o.hardEdges).toEqual([]);
    expect(o.candidateOrder).toEqual([1, 2]);
    expect(o.reasonCodes).toContain("sequence_order_out_of_scope_dependency");
  });
});
