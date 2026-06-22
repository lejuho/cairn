import type { EventRow, FeasibilityParams, MirrorEnergyTrendData, MirrorEnergyTrendDay } from "@cairn/shared";
import { buildFeasibilityParams, computeDayFeasibility } from "./feasibility.js";

const LOW_SAMPLE_THRESHOLD = 3;

export type MirrorEnergyTrendsOptions = {
  from?: string | undefined;
  to?: string | undefined;
  today: string; // server-local YYYY-MM-DD, injected for determinism
  paramOverrides?: Partial<Record<string, number>>;
};

export function buildMirrorEnergyTrends(
  events: EventRow[],
  opts: MirrorEnergyTrendsOptions
): MirrorEnergyTrendData {
  const to = opts.to ?? opts.today;
  const from = opts.from ?? minusDays(to, 30);
  const p = buildFeasibilityParams(opts.paramOverrides ?? {});

  // Filter to planned/confirmed events whose date prefix is within [from, to].
  // Consistent with computeDayFeasibility's startsWith(date) semantics.
  const rangeEvents = events.filter((e) => {
    if (e.start == null) return false;
    const d = e.start.slice(0, 10);
    return d >= from && d <= to;
  });

  const dates = enumerateDates(from, to);
  const dayRows: MirrorEnergyTrendDay[] = [];

  for (const date of dates) {
    // Deterministic now: start of the day in UTC. Gap near-horizon mode is
    // a side effect of computeDayFeasibility; we only use energy + continuous.
    const feas = computeDayFeasibility(date, `${date}T00:00:00Z`, rangeEvents, p);
    const { energy, continuous } = feas;

    if (energy.loadUnits === 0) continue; // skip zero-event days from output list

    dayRows.push({
      date,
      eventCount: rangeEvents.filter((e) => e.start?.startsWith(date) ?? false).length,
      loadUnits: round2(energy.loadUnits),
      budgetUnits: energy.budgetUnits,
      remainingUnits: round2(energy.remainingUnits),
      deficit: energy.deficit,
      continuousExceeded: continuous?.exceedsMax ?? false
    });
  }

  const summary = summarize(dates.length, dayRows, p);

  return {
    range: { from, to },
    summary,
    days: dayRows,
    sampleStatus: summary.scheduledDays < LOW_SAMPLE_THRESHOLD ? "low_sample" : "ok"
  };
}

function summarize(
  totalDays: number,
  days: MirrorEnergyTrendDay[],
  p: FeasibilityParams
): MirrorEnergyTrendData["summary"] {
  const scheduledDays = days.length;
  const deficitDays = days.filter((d) => d.deficit).length;
  const totalLoad = days.reduce((s, d) => s + d.loadUnits, 0);
  const peakLoadUnits = days.length > 0 ? Math.max(...days.map((d) => d.loadUnits)) : 0;
  const averageDailyLoadUnits = round2(totalLoad / Math.max(totalDays, 1));
  const averageScheduledLoadUnits = scheduledDays > 0 ? round2(totalLoad / scheduledDays) : 0;

  return {
    days: totalDays,
    scheduledDays,
    deficitDays,
    averageDailyLoadUnits,
    averageScheduledLoadUnits,
    peakLoadUnits: round2(peakLoadUnits),
    budgetUnits: p.energyBudget,
    sampleStatus: scheduledDays < LOW_SAMPLE_THRESHOLD ? "low_sample" : "ok"
  };
}

function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return dates;
  for (let ms = fromMs; ms <= toMs; ms += 86_400_000) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

function minusDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
