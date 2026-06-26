import { describe, expect, it } from "vitest";
import type { TaskRow, ThreadRow } from "@cairn/shared";
import { computeThreadSettlement, type SettlementEventInput } from "./thread-settlement.js";

function thread(status: ThreadRow["status"]): ThreadRow {
  return { id: 1, name: "T", kind: null, goal: null, definitionOfDone: null, deadline: null, status, createdAt: null };
}
function ev(status: string | null, cost: Partial<SettlementEventInput> = {}): SettlementEventInput {
  return { status, cancelMoney: null, cancelSocial: null, cancelEffort: null, cancelWindow: null, ...cost };
}
function tk(id: number, status: TaskRow["status"]): TaskRow {
  return { id, threadId: 1, title: `T${id}`, estMinutes: null, due: null, context: null, status, optional: 0, createdAt: null };
}

describe("computeThreadSettlement (cycle-53)", () => {
  it("active thread with no nodes → not_ready + empty sample", () => {
    const s = computeThreadSettlement(thread("active"), [], []);
    expect(s.status).toBe("not_ready");
    expect(s.sampleStatus).toBe("empty");
    expect(s.avoidedMissing).toMatchObject({ doneCount: 0, totalCount: 0, knownAvoidedCount: 0, unknownCostCount: 0, money: null, moneyStatus: "unavailable" });
    expect(s.reasonCodes).toEqual(["settlement_not_done", "settlement_no_nodes", "settlement_avoided_money_unavailable"]);
  });

  it("done thread with all direct nodes done → ready + complete sample", () => {
    const s = computeThreadSettlement(thread("done"), [ev("done")], [tk(1, "done")]);
    expect(s.status).toBe("ready");
    expect(s.sampleStatus).toBe("complete");
    expect(s.avoidedMissing).toMatchObject({ doneCount: 2, totalCount: 2, knownAvoidedCount: 2, unknownCostCount: 0 });
    expect(s.reasonCodes).toEqual(["settlement_ready", "settlement_complete", "settlement_avoided_money_unavailable"]);
  });

  it("ready only when thread.status === 'done' (partial nodes still ready, sampleStatus partial)", () => {
    const s = computeThreadSettlement(thread("done"), [ev("done"), ev("planned")], []);
    expect(s.status).toBe("ready");
    expect(s.sampleStatus).toBe("partial");
    expect(s.avoidedMissing).toMatchObject({ doneCount: 1, totalCount: 2, unknownCostCount: 1 });
    // non-done thread statuses → not_ready
    for (const st of ["active", "paused", "dropped", null] as const) {
      expect(computeThreadSettlement(thread(st), [ev("done")], []).status).toBe("not_ready");
    }
  });

  it("moved/cancelled direct events aggregate money/social/effort/window", () => {
    const events = [
      ev("moved", { cancelMoney: 5000, cancelSocial: 1, cancelEffort: "medium", cancelWindow: "내일" }),
      ev("cancelled", { cancelMoney: 2000, cancelSocial: 2, cancelEffort: "high", cancelWindow: "  " }),
      ev("done", { cancelMoney: 9999 }) // not moved/cancelled → ignored for paid cost
    ];
    const s = computeThreadSettlement(thread("done"), events, []);
    expect(s.paidCost.eventCount).toBe(2);
    expect(s.paidCost.money).toBe(7000);
    expect(s.paidCost.social).toBe(3);
    expect(s.paidCost.effort).toEqual({ none: 0, low: 0, medium: 1, high: 1, unknown: 0 });
    expect(s.paidCost.windowCount).toBe(1); // "내일" counts, "  " trimmed empty does not
    expect(s.reasonCodes).toContain("settlement_paid_cost_present");
  });

  it("cancelled event and dropped task are excluded from the avoided denominator", () => {
    // cancelled event still contributes paid cost but not to totalCount/doneCount
    const s = computeThreadSettlement(thread("done"), [ev("cancelled", { cancelMoney: 100 }), ev("done")], [tk(1, "dropped"), tk(2, "done")]);
    expect(s.avoidedMissing.totalCount).toBe(2); // done event + done task
    expect(s.avoidedMissing.doneCount).toBe(2);
    expect(s.paidCost.eventCount).toBe(1); // the cancelled event
  });

  it("partial completion increments unknownCostCount", () => {
    const s = computeThreadSettlement(thread("done"), [ev("done"), ev("planned"), ev("confirmed")], []);
    expect(s.avoidedMissing).toMatchObject({ totalCount: 3, doneCount: 1, unknownCostCount: 2 });
    expect(s.sampleStatus).toBe("partial");
  });

  it("null/blank/unrecognized effort buckets become unknown; money/social null→0", () => {
    const events = [
      ev("moved", { cancelEffort: null }),
      ev("moved", { cancelEffort: "" }),
      ev("moved", { cancelEffort: "extreme" }),
      ev("moved", { cancelEffort: "none" })
    ];
    const s = computeThreadSettlement(thread("done"), events, []);
    expect(s.paidCost.effort).toEqual({ none: 1, low: 0, medium: 0, high: 0, unknown: 3 });
    expect(s.paidCost.money).toBe(0);
    expect(s.paidCost.social).toBe(0);
  });

  it("cancelMoney=0 with non-empty effort/window still counts as paid-cost evidence", () => {
    const s = computeThreadSettlement(thread("done"), [ev("cancelled", { cancelMoney: 0, cancelEffort: "high", cancelWindow: "오늘" })], []);
    expect(s.paidCost.eventCount).toBe(1);
    expect(s.paidCost.money).toBe(0);
    expect(s.paidCost.effort.high).toBe(1);
    expect(s.paidCost.windowCount).toBe(1);
  });

  it("avoidedMissing.money is always null with unavailable status", () => {
    const s = computeThreadSettlement(thread("done"), [ev("done")], []);
    expect(s.avoidedMissing.money).toBeNull();
    expect(s.avoidedMissing.moneyStatus).toBe("unavailable");
  });
});
