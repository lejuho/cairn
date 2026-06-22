import type { WatcherABubble, WatcherRow } from "@cairn/shared";

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

function effectiveThreshold(row: WatcherRow): string | null {
  const rule = parseRule(row.rule);
  if (rule != null) return rule.fireOn;
  if (row.threshold != null && YYYYMMDD.test(row.threshold)) return row.threshold;
  return null;
}

function daysOverdue(date: string, threshold: string): number {
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  const threshMs = Date.parse(`${threshold}T00:00:00Z`);
  return Math.max(0, Math.floor((dateMs - threshMs) / 86_400_000));
}

function bubbleMessage(days: number): string {
  return days === 0 ? "오늘 확인할 watcher야" : `${days}일 지난 watcher야`;
}

export function evaluateWatcherA(
  rows: WatcherRow[],
  date: string, // YYYY-MM-DD
  now: string   // RFC3339 with offset
): WatcherABubble[] {
  const bubbles: WatcherABubble[] = [];

  // `now` is RFC3339-validated at the route; parse once for instant comparison.
  // If NaN slips through, nowMs is NaN and every `snoozedMs > NaN` is false →
  // watchers surface (fail-open), never silently suppressed.
  const nowMs = Date.parse(now);

  for (const row of rows) {
    if (row.armed !== 1) continue;
    if (row.kind !== "A") continue;

    const threshold = effectiveThreshold(row);
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
    bubbles.push({
      id: row.id,
      label: row.label,
      category: row.category,
      kind: "A",
      threshold,
      snoozedUntil: row.snoozedUntil,
      daysOverdue: overdue,
      reasonCodes: ["date_threshold_due"],
      message: bubbleMessage(overdue)
    });
  }

  // Stable sort: threshold asc, id asc
  bubbles.sort((a, b) => {
    if (a.threshold !== b.threshold) return a.threshold < b.threshold ? -1 : 1;
    return a.id - b.id;
  });

  return bubbles;
}
