import type { DayFeasibility, FeasibilityParams, Gap, TransitionTravel } from "@cairn/shared";
import type { EventRow } from "@cairn/shared";
import { computeSequenceEnergy, computeTransitionCosts, type ThreadLinkRow } from "./context-switch.js";
import { computeSequenceOrder, type DependencyLinkRow } from "./sequence-order.js";

export const DEFAULTS: FeasibilityParams = {
  energyBudget: 8,
  meetBufferMinutes: 15,
  deepBufferMinutes: 30,
  travelMargin: 1,
  maxContinuousMinutes: 600
};

const NEAR_HORIZON_MS = 6 * 60 * 60 * 1000;

export function buildFeasibilityParams(overrides: Partial<Record<string, number>>): FeasibilityParams {
  return {
    energyBudget: overrides["energyBudget"] ?? DEFAULTS.energyBudget,
    meetBufferMinutes: overrides["meetBufferMinutes"] ?? DEFAULTS.meetBufferMinutes,
    deepBufferMinutes: overrides["deepBufferMinutes"] ?? DEFAULTS.deepBufferMinutes,
    travelMargin: overrides["travelMargin"] ?? DEFAULTS.travelMargin,
    maxContinuousMinutes: overrides["maxContinuousMinutes"] ?? DEFAULTS.maxContinuousMinutes
  };
}

export function computeDayFeasibility(
  date: string,
  now: string,
  events: EventRow[],
  p: FeasibilityParams,
  // thread_links among the day's threads. Optional: callers that only read
  // energy/continuous (slotCandidates, mirror-energy-trends) omit it, yielding
  // an explanatory transitionCosts array they ignore. Routes pass real rows.
  relations: ThreadLinkRow[] = [],
  // event-event requires/blocks links among the day's events (cycle-48). Optional:
  // internal callers omit it → a quiet sequenceOrder they ignore. Routes pass
  // real rows. Read-only diagnostics; never constrains energy/gaps.
  dependencyLinks: DependencyLinkRow[] = [],
  // Provider-neutral travel-time evidence keyed by `${fromEventId}:${toEventId}`
  // (cycle-76). Computed impurely by the route (cache/gateway) and passed in so
  // this function stays pure. Omitted → byte-identical to pre-cycle-76 behavior.
  travelFacts: Map<string, TransitionTravel> = new Map()
): DayFeasibility {
  const scheduled = dayScheduledEvents(events, date);

  const energy = computeEnergy(scheduled, p);
  const gaps = computeGaps(scheduled, now, p, travelFacts);
  const continuous = computeContinuous(scheduled, p);
  // Travel evidence is attached additively; costLevel/relation are unchanged, so
  // sequenceEnergy (which reads only costLevel) never double-counts travel load.
  const transitionCosts = computeTransitionCosts(scheduled, relations).map((t) => {
    const travel = travelFacts.get(`${t.fromEventId}:${t.toEventId}`);
    return travel ? { ...t, travel } : t;
  });
  const sequenceEnergy = computeSequenceEnergy(energy.loadUnits, transitionCosts, energy.budgetUnits);
  const sequenceOrder = computeSequenceOrder(scheduled, dependencyLinks, relations);

  return { date, now, params: p, energy, gaps, continuous, transitionCosts, sequenceEnergy, sequenceOrder };
}

// The day's scheduled planned/confirmed events (start/end on date), sorted by
// start. Exported so the travel-time builder pairs the SAME adjacent events the
// pure feasibility step does — gaps[i] ↔ transitionCosts[i] ↔ (scheduled[i], i+1).
export function dayScheduledEvents(events: EventRow[], date: string): EventRow[] {
  return events
    .filter((e) =>
      (e.status === "planned" || e.status === "confirmed") &&
      e.start != null &&
      e.end != null &&
      e.start.startsWith(date)
    )
    .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!));
}

// Distinct positive thread ids among the day's scheduled planned/confirmed
// events. Mirrors the `scheduled` filter so routes load exactly the relations
// the service will consider.
export function dayThreadIds(events: EventRow[], date: string): number[] {
  const ids = new Set<number>();
  for (const e of events) {
    if (
      (e.status === "planned" || e.status === "confirmed") &&
      e.start != null &&
      e.end != null &&
      e.start.startsWith(date) &&
      e.threadId != null
    ) {
      ids.add(e.threadId);
    }
  }
  return [...ids];
}

// Day-scheduled event ids (planned/confirmed, start/end on date). Mirrors the
// internal `scheduled` filter so routes load exactly the dependency links the
// sequence-order service will consider. (cycle-48)
export function dayEventIds(events: EventRow[], date: string): number[] {
  const ids: number[] = [];
  for (const e of events) {
    if (
      (e.status === "planned" || e.status === "confirmed") &&
      e.start != null &&
      e.end != null &&
      e.start.startsWith(date)
    ) {
      ids.push(e.id);
    }
  }
  return ids;
}

function computeEnergy(scheduled: EventRow[], p: FeasibilityParams) {
  let loadMs = 0;
  for (const e of scheduled) {
    const start = Date.parse(e.start!);
    const end = Date.parse(e.end!);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      loadMs += end - start;
    }
  }
  const loadUnits = loadMs / (1000 * 60 * 60);
  const budgetUnits = p.energyBudget;
  const remainingUnits = budgetUnits - loadUnits;
  return {
    loadUnits,
    budgetUnits,
    remainingUnits,
    deficit: loadUnits > budgetUnits,
    confidence: "cold_start" as const
  };
}

const TRAVEL_QUIET_REASON: Record<string, string> = {
  stale: "gap_travel_stale",
  unavailable: "gap_travel_unavailable",
  missing_geocode: "gap_travel_missing_geocode",
  same_location: "gap_travel_same_location"
};

function computeGaps(scheduled: EventRow[], now: string, p: FeasibilityParams, travelFacts: Map<string, TransitionTravel>): Gap[] {
  const nowMs = Date.parse(now);
  const gaps: Gap[] = [];

  for (let i = 0; i < scheduled.length - 1; i++) {
    const prev = scheduled[i]!;
    const next = scheduled[i + 1]!;
    const prevEnd = Date.parse(prev.end!);
    const nextStart = Date.parse(next.start!);
    if (Number.isNaN(prevEnd) || Number.isNaN(nextStart)) continue;

    const gapMs = nextStart - prevEnd;
    const availableMinutes = gapMs / (1000 * 60);
    let requiredMinutes = p.meetBufferMinutes;

    // Travel time is added to the requirement ONLY for fresh, usable evidence —
    // stale/unavailable/missing/same-location is context (a reason code), never a
    // hard requirement. Guard durationMinutes != null so a no_route/null fact
    // (which is never `fresh`) can never add 0/NaN to the requirement.
    const travel = travelFacts.get(`${prev.id}:${next.id}`);
    const travelReasonCode = travel ? travelGapReason(travel, p, (extra) => { requiredMinutes += extra; }) : null;

    let status: Gap["status"];
    const reasonCodes: string[] = [];
    if (availableMinutes < 0) {
      status = "impossible";
      reasonCodes.push("gap_impossible");
    } else if (availableMinutes < requiredMinutes) {
      status = "tight";
      reasonCodes.push("gap_tight");
    } else {
      status = "ok";
      reasonCodes.push("gap_ok");
    }
    if (travelReasonCode) reasonCodes.push(travelReasonCode);

    const mode: Gap["mode"] = nextStart - nowMs <= NEAR_HORIZON_MS ? "near" : "planning";

    gaps.push({ availableMinutes, requiredMinutes, status, mode, reasonCodes });
  }

  return gaps;
}

function travelGapReason(travel: TransitionTravel, p: FeasibilityParams, addRequired: (extra: number) => void): string | null {
  if (travel.status === "fresh" && travel.durationMinutes != null) {
    addRequired(Math.round(travel.durationMinutes * p.travelMargin));
    // A user-pinned fact contributes the same duration*margin but is labeled
    // distinctly so the surface can explain "manual" vs provider evidence (cycle-78).
    return travel.source === "pinned_user" ? "gap_travel_pinned_included" : "gap_travel_included";
  }
  return TRAVEL_QUIET_REASON[travel.status] ?? null;
}

function computeContinuous(scheduled: EventRow[], p: FeasibilityParams) {
  const withBoth = scheduled.filter((e) => e.start != null && e.end != null);
  if (withBoth.length === 0) return null;

  const starts = withBoth.map((e) => Date.parse(e.start!)).filter((t) => !Number.isNaN(t));
  const ends = withBoth.map((e) => Date.parse(e.end!)).filter((t) => !Number.isNaN(t));
  if (starts.length === 0 || ends.length === 0) return null;

  const firstStart = Math.min(...starts);
  const lastEnd = Math.max(...ends);
  const spanMinutes = (lastEnd - firstStart) / (1000 * 60);

  return {
    spanMinutes,
    exceedsMax: spanMinutes > p.maxContinuousMinutes
  };
}
