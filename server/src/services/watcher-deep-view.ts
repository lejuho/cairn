import type { WatcherDeepRow, WatcherRow } from "@cairn/shared";

// parseRule and effectiveThreshold are intentionally duplicated from
// server/src/services/watchers.ts (evaluateWatcherA). The logic must
// stay identical — see that file for the canonical comment on each guard.
// Future consolidation: extract to a shared watcher-rule.ts helper.

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

function computeDaysOverdue(date: string, threshold: string): number {
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  const threshMs = Date.parse(`${threshold}T00:00:00Z`);
  return Math.max(0, Math.floor((dateMs - threshMs) / 86_400_000));
}

function computeDaysUntil(date: string, threshold: string): number {
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  const threshMs = Date.parse(`${threshold}T00:00:00Z`);
  return Math.max(0, Math.floor((threshMs - dateMs) / 86_400_000));
}

const STATUS_ORDER: Record<WatcherDeepRow["status"], number> = {
  due: 0,
  snoozed: 1,
  quiet: 2,
  disarmed: 3,
  unsupported: 4
};

export function buildWatcherDeepView(
  rows: WatcherRow[],
  date: string,
  now: string
): WatcherDeepRow[] {
  const nowMs = Date.parse(now);

  const result: WatcherDeepRow[] = rows.map((row): WatcherDeepRow => {
    const armed = row.armed === 1;

    // Disarmed takes priority over all other status checks
    if (!armed) {
      return {
        id: row.id, category: row.category, label: row.label, kind: row.kind,
        armed: false, threshold: row.threshold, snoozedUntil: row.snoozedUntil,
        status: "disarmed", daysOverdue: null, daysUntil: null,
        message: "비활성 watcher야", reasonCodes: ["disarmed"]
      };
    }

    if (row.kind !== "A") {
      return {
        id: row.id, category: row.category, label: row.label, kind: row.kind,
        armed: true, threshold: row.threshold, snoozedUntil: row.snoozedUntil,
        status: "unsupported", daysOverdue: null, daysUntil: null,
        message: "지원되지 않는 watcher 유형이야", reasonCodes: ["unsupported_kind"]
      };
    }

    const threshold = effectiveThreshold(row);
    if (threshold == null) {
      return {
        id: row.id, category: row.category, label: row.label, kind: "A",
        armed: true, threshold: row.threshold, snoozedUntil: row.snoozedUntil,
        status: "unsupported", daysOverdue: null, daysUntil: null,
        message: "날짜 규칙을 읽을 수 없어", reasonCodes: ["malformed_rule"]
      };
    }

    // Overflow date guard (same as evaluateWatcherA)
    const threshMs = Date.parse(`${threshold}T00:00:00Z`);
    if (Number.isNaN(threshMs) || new Date(threshMs).toISOString().slice(0, 10) !== threshold) {
      return {
        id: row.id, category: row.category, label: row.label, kind: "A",
        armed: true, threshold: row.threshold, snoozedUntil: row.snoozedUntil,
        status: "unsupported", daysOverdue: null, daysUntil: null,
        message: "날짜 규칙을 읽을 수 없어", reasonCodes: ["malformed_rule"]
      };
    }

    // Quiet: threshold is in the future
    if (threshold > date) {
      const daysUntil = computeDaysUntil(date, threshold);
      return {
        id: row.id, category: row.category, label: row.label, kind: "A",
        armed: true, threshold, snoozedUntil: row.snoozedUntil,
        status: "quiet", daysOverdue: null, daysUntil,
        message: daysUntil === 1 ? "내일 확인할 watcher야" : `${daysUntil}일 후 확인할 watcher야`,
        reasonCodes: ["date_threshold_pending"]
      };
    }

    // Threshold reached — check snooze
    if (row.snoozedUntil != null) {
      const snoozedMs = Date.parse(row.snoozedUntil);
      if (!Number.isNaN(snoozedMs) && snoozedMs > nowMs) {
        const overdue = computeDaysOverdue(date, threshold);
        return {
          id: row.id, category: row.category, label: row.label, kind: "A",
          armed: true, threshold, snoozedUntil: row.snoozedUntil,
          status: "snoozed", daysOverdue: overdue, daysUntil: null,
          message: overdue === 0 ? "오늘 확인할 watcher — 스누즈 중이야" : `${overdue}일 지난 watcher — 스누즈 중이야`,
          reasonCodes: ["date_threshold_due", "snoozed"]
        };
      }
    }

    // Due
    const overdue = computeDaysOverdue(date, threshold);
    return {
      id: row.id, category: row.category, label: row.label, kind: "A",
      armed: true, threshold, snoozedUntil: row.snoozedUntil,
      status: "due", daysOverdue: overdue, daysUntil: null,
      message: overdue === 0 ? "오늘 확인할 watcher야" : `${overdue}일 지난 watcher야`,
      reasonCodes: ["date_threshold_due"]
    };
  });

  // Sort: due → snoozed → quiet → disarmed → unsupported; within group: threshold asc, id asc
  result.sort((a, b) => {
    const sa = STATUS_ORDER[a.status];
    const sb = STATUS_ORDER[b.status];
    if (sa !== sb) return sa - sb;
    const ta = a.threshold ?? "";
    const tb = b.threshold ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id - b.id;
  });

  return result;
}
