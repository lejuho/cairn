import type { DayFeasibility, FeasibilityParams, Gap } from "@cairn/shared";
import type { EventRow } from "@cairn/shared";

const DEFAULTS: FeasibilityParams = {
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
  p: FeasibilityParams
): DayFeasibility {
  // Only scheduled planned/confirmed events with both start and end on this date
  const scheduled = events
    .filter((e) =>
      (e.status === "planned" || e.status === "confirmed") &&
      e.start != null &&
      e.end != null &&
      e.start.startsWith(date)
    )
    .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!));

  const energy = computeEnergy(scheduled, p);
  const gaps = computeGaps(scheduled, now, p);
  const continuous = computeContinuous(scheduled, p);

  return { date, now, params: p, energy, gaps, continuous };
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

function computeGaps(scheduled: EventRow[], now: string, p: FeasibilityParams): Gap[] {
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
    const requiredMinutes = p.meetBufferMinutes;

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

    const mode: Gap["mode"] = nextStart - nowMs <= NEAR_HORIZON_MS ? "near" : "planning";

    gaps.push({ availableMinutes, requiredMinutes, status, mode, reasonCodes });
  }

  return gaps;
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
