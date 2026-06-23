import type { WatcherABubble, WatcherReasonCode, WatcherRow, ReversePlanView } from "@cairn/shared";
import {
  buildReversePlanView,
  effectiveReversePlanThreshold,
  parseReversePlanRule
} from "./watcher-reverse-plan.js";

type DateThresholdRule = { type: "date_threshold"; fireOn: string };

const YYYYMMDD = /^\d{4}-\d{2}-\d{2}$/;

function parseRule(raw: string | null): DateThresholdRule | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      (parsed as { type: unknown }).type === "date_threshold" &&
      "fireOn" in parsed &&
      typeof (parsed as { fireOn: unknown }).fireOn === "string" &&
      YYYYMMDD.test((parsed as { fireOn: string }).fireOn)
    ) {
      return parsed as DateThresholdRule;
    }
  } catch {
    // JSON parse failure → unsupported
  }
  return null;
}

// Resolves effective threshold + reverse-plan view for Today evaluation.
// For reverse_plan: also returns the view so callers can build descriptive messages.
function resolveThresholdAndView(
  row: WatcherRow,
  taskStatuses: Map<number, string>
): { threshold: string | null; rpView: ReversePlanView | null } {
  const rpRule = parseReversePlanRule(row.rule);
  if (rpRule !== null) {
    const view = buildReversePlanView(rpRule, taskStatuses);
    if (view === null) return { threshold: null, rpView: null };
    if (view.completed) return { threshold: null, rpView: view };
    return { threshold: effectiveReversePlanThreshold(view), rpView: view };
  }

  const dtRule = parseRule(row.rule);
  if (dtRule != null) return { threshold: dtRule.fireOn, rpView: null };
  if (row.threshold != null && YYYYMMDD.test(row.threshold)) return { threshold: row.threshold, rpView: null };
  return { threshold: null, rpView: null };
}

function daysOverdue(date: string, threshold: string): number {
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  const threshMs = Date.parse(`${threshold}T00:00:00Z`);
  return Math.max(0, Math.floor((dateMs - threshMs) / 86_400_000));
}

function bubbleMessage(days: number): string {
  return days === 0 ? "오늘 확인할 watcher야" : `${days}일 지난 watcher야`;
}

function reversePlanBubbleMessage(overdue: number, view: ReversePlanView): string {
  const idx = view.nextStepIndex;
  const label = idx !== null && idx < view.steps.length ? (view.steps[idx]?.label ?? "") : "";
  return overdue === 0 ? `${label}을 시작할 때야` : `${overdue}일 지난 역산 watcher야: ${label}`;
}

export function evaluateWatcherA(
  rows: WatcherRow[],
  date: string,   // YYYY-MM-DD
  now: string,    // RFC3339 with offset
  taskStatuses?: Map<number, string>
): WatcherABubble[] {
  const bubbles: WatcherABubble[] = [];
  const statuses = taskStatuses ?? new Map<number, string>();

  // `now` is RFC3339-validated at the route; parse once for instant comparison.
  // If NaN slips through, nowMs is NaN and every `snoozedMs > NaN` is false →
  // watchers surface (fail-open), never silently suppressed.
  const nowMs = Date.parse(now);

  for (const row of rows) {
    if (row.armed !== 1) continue;
    if (row.kind !== "A") continue;

    const { threshold, rpView } = resolveThresholdAndView(row, statuses);
    if (threshold == null) continue;

    // Reject overflow dates (e.g., "2026-02-30") via round-trip check
    const threshMs = Date.parse(`${threshold}T00:00:00Z`);
    if (Number.isNaN(threshMs)) continue;
    const roundTrip = new Date(threshMs).toISOString().slice(0, 10);
    if (roundTrip !== threshold) continue;

    if (threshold > date) continue;

    // Compare as instants: lexicographic string compare is unsafe across offsets
    // ("...00:30Z" vs "...09:00+09:00" are the same instant). Invalid stored
    // snoozedUntil (NaN) is treated as expired → watcher surfaces (fail-open).
    if (row.snoozedUntil != null) {
      const snoozedMs = Date.parse(row.snoozedUntil);
      if (!Number.isNaN(snoozedMs) && snoozedMs > nowMs) continue;
    }

    const overdue = daysOverdue(date, threshold);
    const reasonCodes: WatcherReasonCode[] = rpView ? ["reverse_plan_due"] : ["date_threshold_due"];
    const message = rpView ? reversePlanBubbleMessage(overdue, rpView) : bubbleMessage(overdue);
    bubbles.push({
      id: row.id,
      label: row.label,
      category: row.category,
      kind: "A",
      threshold,
      snoozedUntil: row.snoozedUntil,
      daysOverdue: overdue,
      reasonCodes,
      message
    });
  }

  // Stable sort: threshold asc, id asc
  bubbles.sort((a, b) => {
    if (a.threshold !== b.threshold) return a.threshold < b.threshold ? -1 : 1;
    return a.id - b.id;
  });

  return bubbles;
}
