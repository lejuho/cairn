import type {
  TaskRow,
  ThreadRow,
  ThreadSettlement,
  ThreadSettlementReasonCode,
  ThreadSettlementSampleStatus
} from "@cairn/shared";
import { aggregatePaidCost, type PaidCostEventInput } from "./paid-cost.js";

// Settlement A (cycle-53 FR-THR-07). Pure deterministic — no DB, LLM, time,
// randomness, or mutation. Summarizes a thread's direct paid-cost evidence and a
// conservative avoided-missing count. Avoided money is never invented.

// Minimal cost-bearing event shape (the Drizzle full row is structurally
// compatible). Settlement reads cancel fields the standard EventRow omits.
// Reuses the shared paid-cost input shape (cycle-60).
export type SettlementEventInput = PaidCostEventInput;

// Matches computeProgressFromRows: cancelled events / dropped tasks (and null
// statuses) are excluded from the progress denominator.
const EXCLUDED_STATUSES = new Set(["cancelled", "dropped"]);

function isCountable(status: string | null): boolean {
  return status != null && !EXCLUDED_STATUSES.has(status);
}

export function computeThreadSettlement(
  thread: ThreadRow,
  events: SettlementEventInput[],
  tasks: TaskRow[]
): ThreadSettlement {
  const status = thread.status === "done" ? "ready" : "not_ready";

  // Countable + done direct nodes (events + tasks), excluding cancelled/dropped.
  const countableStatuses = [
    ...events.map((e) => e.status),
    ...tasks.map((t) => t.status)
  ].filter(isCountable) as string[];
  const totalCount = countableStatuses.length;
  const doneCount = countableStatuses.filter((s) => s === "done").length;

  // Paid cost: only moved/cancelled direct events are actual cost evidence.
  // Shared with rollup via the neutral paid-cost helper (cycle-60).
  const paidCost = aggregatePaidCost(events);
  const paidEventCount = paidCost.eventCount;

  const sampleStatus: ThreadSettlementSampleStatus =
    totalCount === 0 ? "empty" : doneCount === totalCount ? "complete" : "partial";

  // Deterministic reason-code ordering.
  const reasonCodes: ThreadSettlementReasonCode[] = [];
  reasonCodes.push(status === "ready" ? "settlement_ready" : "settlement_not_done");
  if (sampleStatus === "empty") reasonCodes.push("settlement_no_nodes");
  else if (sampleStatus === "complete") reasonCodes.push("settlement_complete");
  else reasonCodes.push("settlement_partial");
  if (paidEventCount > 0) reasonCodes.push("settlement_paid_cost_present");
  reasonCodes.push("settlement_avoided_money_unavailable");

  return {
    status,
    paidCost,
    avoidedMissing: {
      doneCount,
      totalCount,
      knownAvoidedCount: doneCount,
      unknownCostCount: Math.max(0, totalCount - doneCount),
      money: null,
      moneyStatus: "unavailable"
    },
    sampleStatus,
    reasonCodes
  };
}
