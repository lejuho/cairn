import type { MirrorAutomationNeedItem, MirrorAutomationNeedsData, MirrorSampleStatus } from "@cairn/shared";
import { parseManualExogenousRule } from "./watcher-manual-exogenous.js";

export type WatcherRowForNeeds = {
  id: number;
  label: string | null;
  category: string | null;
  kind: string | null;
  rule: string | null;
};

export type LogRowForNeeds = {
  watcherId: number;
  outcome: string;
  observedAt: string;
};

function deriveItem(
  watcher: WatcherRowForNeeds,
  logs: LogRowForNeeds[]
): MirrorAutomationNeedItem | null {
  const rule = parseManualExogenousRule(watcher.rule);
  if (rule === null) return null; // malformed — ignore

  const manualLogCount = logs.length;
  const signalSeenCount = logs.filter((l) => l.outcome === "signal_seen").length;
  const missedSignalCount = logs.filter((l) => l.outcome === "missed_signal").length;
  const missRate = missedSignalCount / Math.max(1, signalSeenCount + missedSignalCount);

  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  let level: MirrorAutomationNeedItem["level"] = "quiet";

  if (manualLogCount < 3) {
    reasonCodes.push("low_sample");
    reasons.push("표본 부족 — 아직 3회 미만 기록됨");
  } else if (rule.sourceStability === "volatile") {
    if (missedSignalCount >= 1 && missRate >= 0.34) {
      level = "watch";
      reasonCodes.push("volatile_source_watch");
      reasons.push(`변동성 높은 출처에서 미스 발생 (미스율 ${Math.round(missRate * 100)}%)`);
    } else {
      reasonCodes.push("volatile_source_quiet");
      reasons.push("변동성 높은 출처이나 미스 없음");
    }
  } else if (
    missedSignalCount >= 1 &&
    missRate >= 0.34 &&
    rule.sourceStability === "stable"
  ) {
    level = "consider_lightweight";
    reasonCodes.push("stable_source_miss_rate");
    reasons.push(`안정적 출처인데 미스율 ${Math.round(missRate * 100)}% — 경량 자동화 고려 시점`);
  } else if (missedSignalCount >= 1) {
    level = "watch";
    reasonCodes.push("miss_seen_below_threshold");
    reasons.push(`미스 ${missedSignalCount}회 발생, 아직 임계치 미달`);
  } else {
    reasonCodes.push("no_misses");
    reasons.push("미스 없음");
  }

  return {
    watcherId: watcher.id,
    label: watcher.label,
    category: watcher.category,
    sourceStability: rule.sourceStability,
    manualLogCount,
    signalSeenCount,
    missedSignalCount,
    missRate,
    level,
    reasonCodes,
    reasons
  };
}

export function buildAutomationNeeds(
  watchers: WatcherRowForNeeds[],
  logs: LogRowForNeeds[],
  range: { from: string; to: string }
): MirrorAutomationNeedsData {
  // Only manual_exogenous kind B watchers
  const manualBWatchers = watchers.filter((w) => w.kind === "B");

  const items: MirrorAutomationNeedItem[] = [];
  for (const watcher of manualBWatchers) {
    const watcherLogs = logs.filter((l) => l.watcherId === watcher.id);
    const item = deriveItem(watcher, watcherLogs);
    if (item !== null) items.push(item);
  }

  // Sorted by level desc (consider_lightweight > watch > quiet), then watcherId asc
  const levelOrder: Record<string, number> = { consider_lightweight: 2, watch: 1, quiet: 0 };
  items.sort((a, b) => {
    const ld = (levelOrder[b.level] ?? 0) - (levelOrder[a.level] ?? 0);
    return ld !== 0 ? ld : a.watcherId - b.watcherId;
  });

  const anyLowSample = items.some((i) => i.reasonCodes.includes("low_sample"));
  const sampleStatus: MirrorSampleStatus = anyLowSample && items.length > 0 ? "low_sample" : "ok";

  return { range, items, sampleStatus };
}
