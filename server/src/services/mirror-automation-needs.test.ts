import { describe, expect, it } from "vitest";
import { buildAutomationNeeds } from "./mirror-automation-needs.js";

const RANGE = { from: "2026-06-01", to: "2026-06-30" };

const BASE_WATCHER = {
  id: 1,
  label: "Test",
  category: null,
  kind: "B",
  rule: JSON.stringify({ type: "manual_exogenous", sourceStability: "unknown", sourceLabel: null, sourceUrl: null })
};

function logs(count: number, outcome: string): { watcherId: number; outcome: string; observedAt: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    watcherId: 1,
    outcome,
    observedAt: `2026-06-${String(i + 1).padStart(2, "0")}T12:00:00Z`
  }));
}

describe("buildAutomationNeeds", () => {
  it("returns empty items when no kind=B watchers", () => {
    const result = buildAutomationNeeds([{ ...BASE_WATCHER, kind: "A" }], [], RANGE);
    expect(result.items).toHaveLength(0);
  });

  it("cold-start (<3 logs) → quiet + low_sample + reasons populated", () => {
    const result = buildAutomationNeeds([BASE_WATCHER], logs(2, "signal_seen"), RANGE);
    const item = result.items[0];
    expect(item?.level).toBe("quiet");
    expect(item?.reasonCodes).toContain("low_sample");
    expect(item?.reasons.length).toBeGreaterThan(0);
    expect(item?.reasons[0]).toMatch(/표본/);
    expect(result.sampleStatus).toBe("low_sample");
  });

  it("volatile source with enough miss → watch", () => {
    const watcherV = {
      ...BASE_WATCHER,
      rule: JSON.stringify({ type: "manual_exogenous", sourceStability: "volatile", sourceLabel: null, sourceUrl: null })
    };
    const allLogs = [
      ...logs(3, "signal_seen"),
      ...logs(2, "missed_signal").map((l, i) => ({ ...l, watcherId: 1, observedAt: `2026-06-1${i}T12:00:00Z` }))
    ];
    const result = buildAutomationNeeds([watcherV], allLogs, RANGE);
    expect(result.items[0]?.level).toBe("watch");
    expect(result.items[0]?.reasonCodes).toContain("volatile_source_watch");
  });

  it("stable source + missRate >= 0.34 → consider_lightweight", () => {
    const watcherS = {
      ...BASE_WATCHER,
      rule: JSON.stringify({ type: "manual_exogenous", sourceStability: "stable", sourceLabel: null, sourceUrl: null })
    };
    const allLogs = [
      ...logs(4, "signal_seen").map((l, i) => ({ ...l, watcherId: 1, observedAt: `2026-06-0${i + 1}T12:00:00Z` })),
      { watcherId: 1, outcome: "missed_signal", observedAt: "2026-06-05T12:00:00Z" },
      { watcherId: 1, outcome: "missed_signal", observedAt: "2026-06-06T12:00:00Z" },
      { watcherId: 1, outcome: "missed_signal", observedAt: "2026-06-07T12:00:00Z" }
    ];
    const result = buildAutomationNeeds([watcherS], allLogs, RANGE);
    expect(result.items[0]?.level).toBe("consider_lightweight");
    expect(result.items[0]?.reasons[0]).toMatch(/안정적 출처/);
  });

  it("unknown stability + single miss → watch", () => {
    const allLogs = [
      ...logs(3, "signal_seen"),
      { watcherId: 1, outcome: "missed_signal", observedAt: "2026-06-04T12:00:00Z" }
    ];
    const result = buildAutomationNeeds([BASE_WATCHER], allLogs, RANGE);
    expect(result.items[0]?.level).toBe("watch");
    expect(result.items[0]?.reasonCodes).toContain("miss_seen_below_threshold");
  });

  it("no misses → quiet", () => {
    const allLogs = logs(5, "signal_seen");
    const result = buildAutomationNeeds([BASE_WATCHER], allLogs, RANGE);
    expect(result.items[0]?.level).toBe("quiet");
    expect(result.items[0]?.reasonCodes).toContain("no_misses");
  });

  it("ignores kind=A watchers", () => {
    const kindAWatcher = { ...BASE_WATCHER, id: 2, kind: "A" };
    const result = buildAutomationNeeds([BASE_WATCHER, kindAWatcher], logs(5, "missed_signal"), RANGE);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.watcherId).toBe(1);
  });

  it("sorts by level desc (consider_lightweight first)", () => {
    const watcherStable = {
      ...BASE_WATCHER,
      id: 1,
      rule: JSON.stringify({ type: "manual_exogenous", sourceStability: "stable", sourceLabel: null, sourceUrl: null })
    };
    const watcherUnknown = {
      ...BASE_WATCHER,
      id: 2,
      rule: JSON.stringify({ type: "manual_exogenous", sourceStability: "unknown", sourceLabel: null, sourceUrl: null })
    };

    const allLogs = [
      ...Array.from({ length: 4 }, (_, i) => ({ watcherId: 1, outcome: "signal_seen", observedAt: `2026-06-0${i + 1}T12:00:00Z` })),
      { watcherId: 1, outcome: "missed_signal", observedAt: "2026-06-05T12:00:00Z" },
      { watcherId: 1, outcome: "missed_signal", observedAt: "2026-06-06T12:00:00Z" },
      { watcherId: 1, outcome: "missed_signal", observedAt: "2026-06-07T12:00:00Z" },
      ...Array.from({ length: 5 }, (_, i) => ({ watcherId: 2, outcome: "signal_seen", observedAt: `2026-06-1${i}T12:00:00Z` }))
    ];
    const result = buildAutomationNeeds([watcherStable, watcherUnknown], allLogs, RANGE);
    expect(result.items[0]?.watcherId).toBe(1);
    expect(result.items[0]?.level).toBe("consider_lightweight");
    expect(result.items[1]?.level).toBe("quiet");
  });
});
