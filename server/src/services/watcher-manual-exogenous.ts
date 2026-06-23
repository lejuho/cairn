import type { ManualExogenousRule, ManualExogenousView, WatcherLogSummary } from "@cairn/shared";

// Manual structural validation — null on any malform or wrong type.
export function parseManualExogenousRule(raw: string | null): ManualExogenousRule | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).type !== "manual_exogenous"
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const stability = obj.sourceStability;
    if (stability !== "unknown" && stability !== "stable" && stability !== "volatile") return null;
    return {
      type: "manual_exogenous",
      sourceLabel: typeof obj.sourceLabel === "string" ? obj.sourceLabel : null,
      sourceUrl: typeof obj.sourceUrl === "string" ? obj.sourceUrl : null,
      sourceStability: stability
    };
  } catch {
    return null;
  }
}

export function buildManualExogenousView(
  rule: ManualExogenousRule,
  summary: WatcherLogSummary
): ManualExogenousView {
  return {
    sourceLabel: rule.sourceLabel,
    sourceUrl: rule.sourceUrl,
    sourceStability: rule.sourceStability,
    summary
  };
}

export function emptyLogSummary(): WatcherLogSummary {
  return {
    windowDays: 30,
    manualLogCount: 0,
    signalSeenCount: 0,
    missedSignalCount: 0,
    checkedNoSignalCount: 0,
    lastOutcome: null,
    lastObservedAt: null
  };
}
