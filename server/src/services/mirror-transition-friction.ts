import type {
  EventRow,
  MirrorTransitionFrictionData,
  MirrorTransitionFrictionDay
} from "@cairn/shared";
import { computeTransitionCosts, type ThreadLinkRow } from "./context-switch.js";
import type { FrictionAnnotationRow } from "../repositories/mirror.js";
import { resolveTrendRange } from "./mirror-energy-trends.js";

const LOW_SAMPLE_THRESHOLD = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

type Outcomes = { done: number; moved: number; cancelled: number; late: number };

// Pure deterministic Mirror transition-friction read model (cycle-49 FR-MIR-09).
// No DB/LLM/external/mutation. Reuses the existing transition classifier — does
// not introduce a second cost model — and aggregates nearby annotation evidence.
export function buildMirrorTransitionFriction(
  events: EventRow[],
  threadLinks: ThreadLinkRow[],
  annotations: FrictionAnnotationRow[],
  opts: { from?: string | undefined; to?: string | undefined; today: string }
): MirrorTransitionFrictionData {
  const range = resolveTrendRange(opts.from, opts.to, opts.today);

  // Inclusive day count.
  const fromMs = Date.parse(`${range.from}T00:00:00Z`);
  const toMs = Date.parse(`${range.to}T00:00:00Z`);
  const days = Math.max(0, Math.round((toMs - fromMs) / 86_400_000) + 1);

  // Scheduled events within the range, grouped by start date.
  const eventsByDate = new Map<string, EventRow[]>();
  for (const e of events) {
    if (e.start == null) continue;
    const d = dayKey(e.start);
    if (d < range.from || d > range.to) continue;
    const bucket = eventsByDate.get(d) ?? [];
    bucket.push(e);
    eventsByDate.set(d, bucket);
  }

  // Annotation evidence grouped by logged date.
  const outcomesByDate = new Map<string, Outcomes>();
  const energyByDate = new Map<string, number[]>();
  for (const a of annotations) {
    if (a.loggedAt == null) continue;
    const d = dayKey(a.loggedAt);
    if (d < range.from || d > range.to) continue;
    if (a.outcome === "done" || a.outcome === "moved" || a.outcome === "cancelled" || a.outcome === "late") {
      const o = outcomesByDate.get(d) ?? { done: 0, moved: 0, cancelled: 0, late: 0 };
      o[a.outcome] += 1;
      outcomesByDate.set(d, o);
    }
    if (a.energyAtTime != null) {
      const list = energyByDate.get(d) ?? [];
      list.push(a.energyAtTime);
      energyByDate.set(d, list);
    }
  }

  // One row per active day (≥1 scheduled event), newest first.
  const activeDates = [...eventsByDate.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const dayRows: MirrorTransitionFrictionDay[] = [];
  let totalTransitionPairs = 0;
  let totalLow = 0;
  let totalHigh = 0;
  let totalUnknown = 0;
  let lowSampleDays = 0;

  for (const date of activeDates) {
    const dayEvents = eventsByDate.get(date)!; // already sorted (start asc, id asc) by the read
    const pairs = computeTransitionCosts(dayEvents, threadLinks);

    let sameThreadPairs = 0;
    let contextPairs = 0;
    let unrelatedPairs = 0;
    let missingThreadPairs = 0;
    let low = 0;
    let high = 0;
    let unknown = 0;
    for (const p of pairs) {
      if (p.relation === "same_thread") sameThreadPairs += 1;
      else if (p.relation === "context_link") contextPairs += 1;
      else if (p.relation === "non_context_link" || p.relation === "unrelated") unrelatedPairs += 1;
      else if (p.relation === "missing_thread") missingThreadPairs += 1;

      if (p.costLevel === "low") low += 1;
      else if (p.costLevel === "high") high += 1;
      else if (p.costLevel === "unknown") unknown += 1;
    }

    const transitionPairs = pairs.length;
    const outcomes = outcomesByDate.get(date) ?? { done: 0, moved: 0, cancelled: 0, late: 0 };
    const energyList = energyByDate.get(date) ?? [];
    const energy = {
      entryCount: energyList.length,
      averageEnergyAtTime: energyList.length > 0 ? round2(energyList.reduce((s, v) => s + v, 0) / energyList.length) : null
    };

    const daySampleStatus: "ok" | "low_sample" = transitionPairs === 0 ? "low_sample" : "ok";
    if (daySampleStatus === "low_sample") lowSampleDays += 1;

    const reasonCodes: string[] = [];
    if (transitionPairs === 0) reasonCodes.push("friction_no_transitions");
    if (high > 0) reasonCodes.push("friction_high_present");
    if (unknown > 0) reasonCodes.push("friction_unknown_present");
    if (daySampleStatus === "low_sample") reasonCodes.push("friction_low_sample");

    totalTransitionPairs += transitionPairs;
    totalLow += low;
    totalHigh += high;
    totalUnknown += unknown;

    dayRows.push({
      date,
      eventCount: dayEvents.length,
      transitionPairs,
      sameThreadPairs,
      contextPairs,
      unrelatedPairs,
      missingThreadPairs,
      lowTransitionPairs: low,
      highTransitionPairs: high,
      unknownTransitionPairs: unknown,
      outcomes,
      energy,
      sampleStatus: daySampleStatus,
      reasonCodes
    });
  }

  const activeDays = dayRows.length;
  const sampleStatus: "ok" | "low_sample" = activeDays < LOW_SAMPLE_THRESHOLD ? "low_sample" : "ok";

  return {
    range,
    summary: {
      days,
      activeDays,
      totalTransitionPairs,
      lowTransitionPairs: totalLow,
      highTransitionPairs: totalHigh,
      unknownTransitionPairs: totalUnknown,
      lowSampleDays,
      sampleStatus
    },
    days: dayRows
  };
}
