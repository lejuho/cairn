import type {
  TaskRow,
  ThreadRow,
  ThreadSettlement,
  ThreadSettlementEffortBucket,
  ThreadSettlementReasonCode,
  ThreadSettlementSampleStatus
} from "@cairn/shared";

// Settlement A (cycle-53 FR-THR-07). Pure deterministic — no DB, LLM, time,
// randomness, or mutation. Summarizes a thread's direct paid-cost evidence and a
// conservative avoided-missing count. Avoided money is never invented.

// Minimal cost-bearing event shape (the Drizzle full row is structurally
// compatible). Settlement reads cancel fields the standard EventRow omits.
export type SettlementEventInput = {
  status: string | null;
  cancelMoney: number | null;
  cancelSocial: number | null;
  cancelEffort: string | null;
  cancelWindow: string | null;
};

// Matches computeProgressFromRows: cancelled events / dropped tasks (and null
// statuses) are excluded from the progress denominator.
const EXCLUDED_STATUSES = new Set(["cancelled", "dropped"]);
const PAID_COST_STATUSES = new Set(["moved", "cancelled"]);
const KNOWN_EFFORT = new Set(["none", "low", "medium", "high"]);

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
  const effort: ThreadSettlementEffortBucket = { none: 0, low: 0, medium: 0, high: 0, unknown: 0 };
  let money = 0;
  let social = 0;
  let windowCount = 0;
  let paidEventCount = 0;
  for (const e of events) {
    if (e.status == null || !PAID_COST_STATUSES.has(e.status)) continue;
    paidEventCount += 1;
    money += e.cancelMoney ?? 0;
    social += e.cancelSocial ?? 0;
    const bucket = e.cancelEffort != null && KNOWN_EFFORT.has(e.cancelEffort) ? (e.cancelEffort as keyof ThreadSettlementEffortBucket) : "unknown";
    effort[bucket] += 1;
    if (e.cancelWindow != null && e.cancelWindow.trim() !== "") windowCount += 1;
  }

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
    paidCost: { eventCount: paidEventCount, money, social, effort, windowCount },
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
