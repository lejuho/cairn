// Pure watcher push selector — no DB, no network, no LLM.
// parseRule/effectiveThreshold copied from watchers.ts and watcher-deep-view.ts
// (cross-reference: keep all three in sync if date_threshold rule schema changes).
import type { WatcherRow } from "@cairn/shared";

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
    // JSON parse failure → skip
  }
  return null;
}

function effectiveThreshold(row: WatcherRow): string | null {
  const rule = parseRule(row.rule);
  if (rule != null) return rule.fireOn;
  if (row.threshold != null && YYYYMMDD.test(row.threshold)) return row.threshold;
  return null;
}

export type WatcherPushItem = {
  id: number;
  label: string | null;
  category: string | null;
  threshold: string;
  daysOverdue: number;
};

export type WatcherPushResult = {
  items: WatcherPushItem[];
  message: string;
};

export function selectDueForPush(
  rows: WatcherRow[],
  date: string, // YYYY-MM-DD local date
  now: string   // RFC3339 — for active snooze comparison
): WatcherPushResult {
  const nowMs = Date.parse(now);
  const items: WatcherPushItem[] = [];

  for (const row of rows) {
    if (row.armed !== 1) continue;
    if (row.kind !== "A") continue;

    const threshold = effectiveThreshold(row);
    if (threshold == null) continue;

    const threshMs = Date.parse(`${threshold}T00:00:00Z`);
    if (Number.isNaN(threshMs)) continue;
    // Reject overflow dates via round-trip check (same invariant as watchers.ts)
    if (new Date(threshMs).toISOString().slice(0, 10) !== threshold) continue;

    if (threshold > date) continue;

    // Active snooze: fail-open on NaN (treat as expired)
    if (row.snoozedUntil != null) {
      const snoozedMs = Date.parse(row.snoozedUntil);
      if (!Number.isNaN(snoozedMs) && snoozedMs > nowMs) continue;
    }

    // Same-date last_fired → idempotency gate
    if (row.lastFired != null && row.lastFired.slice(0, 10) === date) continue;

    const dateMs = Date.parse(`${date}T00:00:00Z`);
    const daysOverdue = Math.max(0, Math.floor((dateMs - threshMs) / 86_400_000));

    items.push({ id: row.id, label: row.label, category: row.category, threshold, daysOverdue });
  }

  // Stable sort: threshold asc, id asc
  items.sort((a, b) => {
    if (a.threshold !== b.threshold) return a.threshold < b.threshold ? -1 : 1;
    return a.id - b.id;
  });

  return { items, message: buildDigestMessage(items, date) };
}

function buildDigestMessage(items: WatcherPushItem[], date: string): string {
  if (items.length === 0) return "";
  const header = `[여백] ${date} — 확인할 watcher ${items.length}개`;
  const lines = items.map((item) => {
    const name = item.label ?? "(이름 없음)";
    const cat = item.category ? ` [${item.category}]` : "";
    const overdue =
      item.daysOverdue === 0 ? "오늘 마감" : `${item.daysOverdue}일 지남`;
    return `• ${name}${cat} (${item.threshold}, ${overdue})`;
  });
  return [header, "", ...lines].join("\n");
}
