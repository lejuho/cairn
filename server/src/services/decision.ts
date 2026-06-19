import type { ConflictDecision, ConflictDecisionOption, EventRow } from "@cairn/shared";
import type { PersonContextItem } from "../repositories/people.js";
import { computeSocialContext, evaluatePeopleGuard } from "./people-impact.js";

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
  events: EventWithCosts[],
  eventPeopleContext?: Map<number, PersonContextItem[]>
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
      const aPeople = eventPeopleContext?.get(a.id) ?? [];
      const bPeople = eventPeopleContext?.get(b.id) ?? [];
      const options = buildOptions(a, b, aPeople, bPeople);
      const { actionability, disabledReasonCodes } = computeActionability(nowMs, aStart, bStart);

      decisions.push({ id, pair: { a: toEventRow(a), b: toEventRow(b) }, overlapMinutes, urgency, actionability, disabledReasonCodes, options });
    }
  }

  return decisions;
}

function buildOptions(
  a: EventWithCosts,
  b: EventWithCosts,
  aPeople: PersonContextItem[],
  bPeople: PersonContextItem[]
): [ConflictDecisionOption, ConflictDecisionOption] {
  // socialContext: for option A (cancel A), A's linked people affect A's social cost
  const socialCtxA = computeSocialContext(a.cancelSocial ?? null, aPeople);
  const socialCtxB = computeSocialContext(b.cancelSocial ?? null, bPeople);

  // peopleGuard: for option A (keep B), check B's linked people constraints against B's start
  const guardA = evaluatePeopleGuard(b.id, b.start ?? null, bPeople);
  const guardB = evaluatePeopleGuard(a.id, a.start ?? null, aPeople);

  const effectiveSocialA = socialCtxA.effective;
  const effectiveSocialB = socialCtxB.effective;

  const scoreA = internalScoreWithContext(a, effectiveSocialA);
  const scoreB = internalScoreWithContext(b, effectiveSocialB);
  const anyKnownA = hasKnownCostWithContext(a, effectiveSocialA);
  const anyKnownB = hasKnownCostWithContext(b, effectiveSocialB);

  let suggestedA = false;
  let suggestedB = false;
  // Blocked options are never suggested
  if ((anyKnownA || anyKnownB) && scoreA !== scoreB) {
    if (scoreA < scoreB && !guardA.blocked) {
      suggestedA = true;
    } else if (scoreB < scoreA && !guardB.blocked) {
      suggestedB = true;
    }
  }
  // If one side is blocked and the other is not, mark the unblocked as required by guard
  let reasonCodesA = suggestedA ? ["lower_cancel_cost"] : [];
  let reasonCodesB = suggestedB ? ["lower_cancel_cost"] : [];
  if (guardA.blocked && !guardB.blocked) {
    reasonCodesB = [...new Set([...reasonCodesB, "required_by_people_constraint"])];
  } else if (guardB.blocked && !guardA.blocked) {
    reasonCodesA = [...new Set([...reasonCodesA, "required_by_people_constraint"])];
  }

  const optA: ConflictDecisionOption = {
    event: toEventRow(a),
    action: "move_or_cancel",
    cost: {
      money: a.cancelMoney ?? null,
      social: effectiveSocialA,
      effort: a.cancelEffort ?? null,
      window: a.cancelWindow ?? null
    },
    reversible: a.reversible ?? null,
    commitment: a.commitment ?? null,
    suggested: suggestedA,
    reasonCodes: reasonCodesA,
    socialContext: socialCtxA,
    peopleGuard: guardA
  };

  const optB: ConflictDecisionOption = {
    event: toEventRow(b),
    action: "move_or_cancel",
    cost: {
      money: b.cancelMoney ?? null,
      social: effectiveSocialB,
      effort: b.cancelEffort ?? null,
      window: b.cancelWindow ?? null
    },
    reversible: b.reversible ?? null,
    commitment: b.commitment ?? null,
    suggested: suggestedB,
    reasonCodes: reasonCodesB,
    socialContext: socialCtxB,
    peopleGuard: guardB
  };

  return [optA, optB];
}

function hasKnownCostWithContext(e: EventWithCosts, effectiveSocial: number | null): boolean {
  const moneyKnown = e.cancelMoney != null && e.cancelMoney > 0;
  const socialKnown = effectiveSocial != null && effectiveSocial > 0;
  const effortKnown = e.cancelEffort != null && e.cancelEffort !== "none";
  // reversible is intentionally excluded: it is used as a tiebreak penalty only
  // after a cost gate, never as the sole trigger for a suggestion
  return moneyKnown || socialKnown || effortKnown;
}

function internalScoreWithContext(e: EventWithCosts, effectiveSocial: number | null): number {
  const money = e.cancelMoney ?? 0;
  const social = effectiveSocial ?? 0;
  const effort = EFFORT_ORDINAL[e.cancelEffort ?? "none"] ?? 0;
  // Non-reversible adds a penalty for ordering only; never returned to client
  const irreversiblePenalty = e.reversible === 0 ? 10 : 0;
  return money + social + effort + irreversiblePenalty;
}

// Strict forward-only gate: start must be at or after now AND within the 6h horizon.
// Past-start events (start < now) are NOT resolvable even if still ongoing.
export function isResolvable(nowMs: number, startMs: number): boolean {
  return startMs >= nowMs && startMs - nowMs <= NEAR_HORIZON_MS;
}

function computeActionability(
  nowMs: number,
  aStart: number,
  bStart: number
): { actionability: ConflictDecision["actionability"]; disabledReasonCodes: string[] } {
  if (isResolvable(nowMs, aStart) || isResolvable(nowMs, bStart)) {
    return { actionability: "resolvable", disabledReasonCodes: [] };
  }
  // Determine why not resolvable for UI copy
  const aInPast = aStart < nowMs;
  const bInPast = bStart < nowMs;
  if (aInPast || bInPast) {
    return { actionability: "read_only", disabledReasonCodes: ["past_start"] };
  }
  return { actionability: "read_only", disabledReasonCodes: ["far_future"] };
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
