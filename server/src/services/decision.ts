import type { ConflictDecision, ConflictDecisionOption, EventRow } from "@cairn/shared";

const NEAR_HORIZON_MS = 6 * 60 * 60 * 1000;

// cancel_effort text enum → ordinal for internal ordering only
const EFFORT_ORDINAL: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

// Raw DB row shape with cost columns; status is string|null from DB
export type EventWithCosts = {
  id: number;
  title: string;
  start: string | null;
  end: string | null;
  status: string | null;
  cancelMoney: number | null;
  cancelSocial: number | null;
  cancelEffort: string | null;
  cancelWindow: string | null;
  reversible: number | null;
  commitment: number | null;
  [key: string]: unknown;
};

export function buildConflictDecisions(
  now: string,
  events: EventWithCosts[]
): ConflictDecision[] {
  const scheduled = events.filter(
    (e) =>
      (e.status === "planned" || e.status === "confirmed") &&
      e.start != null &&
      e.end != null
  );

  const nowMs = Date.parse(now);
  const decisions: ConflictDecision[] = [];

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]!;
      const b = scheduled[j]!;
      const aStart = Date.parse(a.start!);
      const aEnd = Date.parse(a.end!);
      const bStart = Date.parse(b.start!);
      const bEnd = Date.parse(b.end!);

      if (Number.isNaN(aStart) || Number.isNaN(aEnd) || Number.isNaN(bStart) || Number.isNaN(bEnd))
        continue;

      const overlapMs = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
      if (overlapMs <= 0) continue;

      const overlapMinutes = overlapMs / (1000 * 60);
      const urgency: ConflictDecision["urgency"] =
        aStart - nowMs <= NEAR_HORIZON_MS || bStart - nowMs <= NEAR_HORIZON_MS
          ? "near"
          : "planning";

      const id = [a.id, b.id].sort((x, y) => x - y).join(":");
      const options = buildOptions(a, b);

      decisions.push({ id, pair: { a: toEventRow(a), b: toEventRow(b) }, overlapMinutes, urgency, options });
    }
  }

  return decisions;
}

function buildOptions(
  a: EventWithCosts,
  b: EventWithCosts
): [ConflictDecisionOption, ConflictDecisionOption] {
  const scoreA = internalScore(a);
  const scoreB = internalScore(b);
  const anyKnownA = hasKnownCost(a);
  const anyKnownB = hasKnownCost(b);

  let suggestedA = false;
  let suggestedB = false;
  // Only suggest when at least one side has a known value and one side is clearly lower
  if ((anyKnownA || anyKnownB) && scoreA !== scoreB) {
    if (scoreA < scoreB) {
      suggestedA = true; // lower cost to cancel A → suggest cancelling A
    } else {
      suggestedB = true;
    }
  }

  const optA: ConflictDecisionOption = {
    event: toEventRow(a),
    action: "move_or_cancel",
    cost: {
      money: a.cancelMoney ?? null,
      social: a.cancelSocial ?? null,
      effort: a.cancelEffort ?? null,
      window: a.cancelWindow ?? null
    },
    reversible: a.reversible ?? null,
    commitment: a.commitment ?? null,
    suggested: suggestedA,
    reasonCodes: suggestedA ? ["lower_cancel_cost"] : []
  };

  const optB: ConflictDecisionOption = {
    event: toEventRow(b),
    action: "move_or_cancel",
    cost: {
      money: b.cancelMoney ?? null,
      social: b.cancelSocial ?? null,
      effort: b.cancelEffort ?? null,
      window: b.cancelWindow ?? null
    },
    reversible: b.reversible ?? null,
    commitment: b.commitment ?? null,
    suggested: suggestedB,
    reasonCodes: suggestedB ? ["lower_cancel_cost"] : []
  };

  return [optA, optB];
}

function hasKnownCost(e: EventWithCosts): boolean {
  const moneyKnown = e.cancelMoney != null && e.cancelMoney > 0;
  const socialKnown = e.cancelSocial != null && e.cancelSocial > 0;
  const effortKnown = e.cancelEffort != null && e.cancelEffort !== "none";
  // reversible is intentionally excluded: it is used as a tiebreak penalty only
  // after a cost gate, never as the sole trigger for a suggestion
  return moneyKnown || socialKnown || effortKnown;
}

function internalScore(e: EventWithCosts): number {
  const money = e.cancelMoney ?? 0;
  const social = e.cancelSocial ?? 0;
  const effort = EFFORT_ORDINAL[e.cancelEffort ?? "none"] ?? 0;
  // Non-reversible adds a penalty for ordering only; never returned to client
  const irreversiblePenalty = e.reversible === 0 ? 10 : 0;
  return money + social + effort + irreversiblePenalty;
}

export function eventsOverlap(a: EventWithCosts, b: EventWithCosts): boolean {
  if (!a.start || !a.end || !b.start || !b.end) return false;
  const aStart = Date.parse(a.start);
  const aEnd = Date.parse(a.end);
  const bStart = Date.parse(b.start);
  const bEnd = Date.parse(b.end);
  if (Number.isNaN(aStart) || Number.isNaN(aEnd) || Number.isNaN(bStart) || Number.isNaN(bEnd))
    return false;
  return aStart < bEnd && bStart < aEnd;
}

function toEventRow(e: EventWithCosts): EventRow {
  return e as unknown as EventRow;
}
