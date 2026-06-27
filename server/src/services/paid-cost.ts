import type { ThreadSettlementEffortBucket, ThreadSettlementPaidCost } from "@cairn/shared";

// Shared deterministic paid-cost aggregation. Pure: no DB/LLM/time/randomness/
// mutation. Reused by FR-THR-07 direct settlement and FR-THR-10 parent rollup
// so the money/social/effort/window semantics never drift between them.
//
// Only `moved`/`cancelled` events are actual paid-cost evidence. money sums
// cancelMoney (null → 0); effort is bucketed (unknown when missing/invalid);
// windowCount counts non-empty cancelWindow. A null/zero money event still
// counts via eventCount and its social/effort/window evidence.

export type PaidCostEventInput = {
  status: string | null;
  cancelMoney: number | null;
  cancelSocial: number | null;
  cancelEffort: string | null;
  cancelWindow: string | null;
};

const PAID_COST_STATUSES = new Set(["moved", "cancelled"]);
const KNOWN_EFFORT = new Set(["none", "low", "medium", "high"]);

export function emptyPaidCost(): ThreadSettlementPaidCost {
  return {
    eventCount: 0,
    money: 0,
    social: 0,
    effort: { none: 0, low: 0, medium: 0, high: 0, unknown: 0 },
    windowCount: 0
  };
}

export function aggregatePaidCost(events: PaidCostEventInput[]): ThreadSettlementPaidCost {
  const out = emptyPaidCost();
  for (const e of events) {
    if (e.status == null || !PAID_COST_STATUSES.has(e.status)) continue;
    out.eventCount += 1;
    out.money += e.cancelMoney ?? 0;
    out.social += e.cancelSocial ?? 0;
    const bucket: keyof ThreadSettlementEffortBucket =
      e.cancelEffort != null && KNOWN_EFFORT.has(e.cancelEffort)
        ? (e.cancelEffort as keyof ThreadSettlementEffortBucket)
        : "unknown";
    out.effort[bucket] += 1;
    if (e.cancelWindow != null && e.cancelWindow.trim() !== "") out.windowCount += 1;
  }
  return out;
}

// Bucket-by-bucket sum. rollup.total.paidCost MUST be sumPaidCost(direct,
// contains) — never a re-aggregation — so total always equals its parts.
export function sumPaidCost(
  a: ThreadSettlementPaidCost,
  b: ThreadSettlementPaidCost
): ThreadSettlementPaidCost {
  return {
    eventCount: a.eventCount + b.eventCount,
    money: a.money + b.money,
    social: a.social + b.social,
    effort: {
      none: a.effort.none + b.effort.none,
      low: a.effort.low + b.effort.low,
      medium: a.effort.medium + b.effort.medium,
      high: a.effort.high + b.effort.high,
      unknown: a.effort.unknown + b.effort.unknown
    },
    windowCount: a.windowCount + b.windowCount
  };
}
