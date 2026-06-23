import type { ManualExogenousView, ReversePlanView, WatcherDeepRow, WatcherLogSummary, WatcherRow } from "@cairn/shared";
import {
  buildReversePlanView,
  effectiveReversePlanThreshold,
  parseReversePlanRule
} from "./watcher-reverse-plan.js";
import { buildManualExogenousView, emptyLogSummary, parseManualExogenousRule } from "./watcher-manual-exogenous.js";

// parseRule and effectiveThreshold are intentionally duplicated from
// server/src/services/watchers.ts (evaluateWatcherA). The logic must
// stay identical — see that file for the canonical comment on each guard.
// Future consolidation: extract to a shared watcher-rule.ts helper.

type DateThresholdRule = { type: "date_threshold"; fireOn: string };

const YYYYMMDD = /^\d{4}-\d{2}-\d{2}$/;

function parseDateThresholdRule(raw: string | null): DateThresholdRule | null {
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

// Resolves the effective threshold for a row.
// For date_threshold: uses rule.fireOn.
// For reverse_plan: uses the next incomplete step's latestDate from the view.
// Falls back to row.threshold for legacy rows without rule JSON.
function resolveThreshold(
  row: WatcherRow,
  reversePlanView: ReversePlanView | null
): string | null {
  if (reversePlanView !== null) {
    if (reversePlanView.completed) return null;
    return effectiveReversePlanThreshold(reversePlanView);
  }
  const dtRule = parseDateThresholdRule(row.rule);
  if (dtRule != null) return dtRule.fireOn;
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
  now: string,
  taskStatuses?: Map<number, string>,
  logSummaries?: Map<number, WatcherLogSummary>
): WatcherDeepRow[] {
  const nowMs = Date.parse(now);
  const statuses = taskStatuses ?? new Map<number, string>();
  const summaries = logSummaries ?? new Map<number, WatcherLogSummary>();

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

    // Handle kind="B" manual-exogenous watchers
    if (row.kind === "B") {
      const meRule = parseManualExogenousRule(row.rule);
      if (meRule === null) {
        return {
          id: row.id, category: row.category, label: row.label, kind: row.kind,
          armed: true, threshold: null, snoozedUntil: row.snoozedUntil,
          status: "unsupported", daysOverdue: null, daysUntil: null,
          message: "지원되지 않는 watcher 유형이야", reasonCodes: ["unsupported_kind"]
        };
      }
      const summary = summaries.get(row.id) ?? emptyLogSummary();
      const meView: ManualExogenousView = buildManualExogenousView(meRule, summary);
      return {
        id: row.id, category: row.category, label: row.label, kind: row.kind,
        armed: true, threshold: null, snoozedUntil: row.snoozedUntil,
        status: "quiet", daysOverdue: null, daysUntil: null,
        message: "수동 확인 watcher야", reasonCodes: ["manual_exogenous"],
        manualExogenous: meView
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

    // Attempt to parse a reverse-plan rule first
    const reversePlanRule = parseReversePlanRule(row.rule);
    let reversePlanView: ReversePlanView | null = null;
    if (reversePlanRule !== null) {
      reversePlanView = buildReversePlanView(reversePlanRule, statuses);
      if (reversePlanView === null) {
        // Missing task IDs → degraded unsupported
        return {
          id: row.id, category: row.category, label: row.label, kind: "A",
          armed: true, threshold: row.threshold, snoozedUntil: row.snoozedUntil,
          status: "unsupported", daysOverdue: null, daysUntil: null,
          message: "역산 계획 데이터를 읽을 수 없어", reasonCodes: ["malformed_rule"],
          reversePlan: undefined
        };
      }

      // Completed chain: quiet, no threshold
      if (reversePlanView.completed) {
        return {
          id: row.id, category: row.category, label: row.label, kind: "A",
          armed: true, threshold: row.threshold, snoozedUntil: row.snoozedUntil,
          status: "quiet", daysOverdue: null, daysUntil: null,
          message: "모든 단계 완료된 watcher야",
          reasonCodes: ["reverse_plan_completed"],
          reversePlan: reversePlanView
        };
      }
    }

    const threshold = resolveThreshold(row, reversePlanView);
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
      const nextLabel = reversePlanView
        ? reversePlanView.steps[reversePlanView.nextStepIndex!]?.label ?? ""
        : "";
      const quietMsg = reversePlanView
        ? `${daysUntil}일 후 시작할 단계야${nextLabel ? `: ${nextLabel}` : ""}`
        : daysUntil === 1 ? "내일 확인할 watcher야" : `${daysUntil}일 후 확인할 watcher야`;
      return {
        id: row.id, category: row.category, label: row.label, kind: "A",
        armed: true, threshold, snoozedUntil: row.snoozedUntil,
        status: "quiet", daysOverdue: null, daysUntil,
        message: quietMsg,
        reasonCodes: reversePlanView ? ["reverse_plan_pending"] : ["date_threshold_pending"],
        reversePlan: reversePlanView ?? undefined
      };
    }

    // Threshold reached — check snooze
    if (row.snoozedUntil != null) {
      const snoozedMs = Date.parse(row.snoozedUntil);
      if (!Number.isNaN(snoozedMs) && snoozedMs > nowMs) {
        const overdue = computeDaysOverdue(date, threshold);
        const snoozeMsg = reversePlanView
          ? `역산 watcher — 스누즈 중이야`
          : overdue === 0 ? "오늘 확인할 watcher — 스누즈 중이야" : `${overdue}일 지난 watcher — 스누즈 중이야`;
        return {
          id: row.id, category: row.category, label: row.label, kind: "A",
          armed: true, threshold, snoozedUntil: row.snoozedUntil,
          status: "snoozed", daysOverdue: overdue, daysUntil: null,
          message: snoozeMsg,
          reasonCodes: reversePlanView
            ? ["reverse_plan_due", "snoozed"]
            : ["date_threshold_due", "snoozed"],
          reversePlan: reversePlanView ?? undefined
        };
      }
    }

    // Due
    const overdue = computeDaysOverdue(date, threshold);
    if (reversePlanView) {
      const nextStep = reversePlanView.steps[reversePlanView.nextStepIndex!];
      const dueMsg = nextStep
        ? overdue === 0
          ? `${nextStep.label}을 시작할 때야`
          : `${overdue}일 지난 역산 watcher야`
        : overdue === 0 ? "오늘 확인할 watcher야" : `${overdue}일 지난 watcher야`;
      return {
        id: row.id, category: row.category, label: row.label, kind: "A",
        armed: true, threshold, snoozedUntil: row.snoozedUntil,
        status: "due", daysOverdue: overdue, daysUntil: null,
        message: dueMsg,
        reasonCodes: ["reverse_plan_due"],
        reversePlan: reversePlanView
      };
    }

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
