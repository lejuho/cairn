import { describe, expect, it } from "vitest";
import type { WatcherRow } from "@cairn/shared";
import { buildWatcherDeepView } from "./watcher-deep-view.js";

const DATE = "2026-06-22"; // Monday
const NOW = "2026-06-22T09:00:00+09:00";

function row(overrides: Partial<WatcherRow> = {}): WatcherRow {
  return {
    id: 1,
    category: null,
    label: "테스트",
    kind: "A",
    armed: 1,
    rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-06-20" }),
    threshold: "2026-06-20",
    lastFired: null,
    snoozedUntil: null,
    createdAt: null,
    ...overrides
  };
}

describe("buildWatcherDeepView — status derivation", () => {
  it("armed A threshold in past → due with daysOverdue", () => {
    const result = buildWatcherDeepView([row()], DATE, NOW);
    expect(result[0]!.status).toBe("due");
    expect(result[0]!.daysOverdue).toBe(2); // 2026-06-22 - 2026-06-20 = 2
    expect(result[0]!.daysUntil).toBeNull();
    expect(result[0]!.reasonCodes).toContain("date_threshold_due");
  });

  it("armed A threshold in future → quiet with daysUntil", () => {
    const r = row({ rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-06-25" }), threshold: "2026-06-25" });
    const result = buildWatcherDeepView([r], DATE, NOW);
    expect(result[0]!.status).toBe("quiet");
    expect(result[0]!.daysUntil).toBe(3);
    expect(result[0]!.daysOverdue).toBeNull();
    expect(result[0]!.reasonCodes).toContain("date_threshold_pending");
  });

  it("armed A threshold reached with active snooze → snoozed", () => {
    const r = row({ snoozedUntil: "2026-06-23T00:00:00+00:00" }); // snooze until tomorrow
    const result = buildWatcherDeepView([r], DATE, NOW);
    expect(result[0]!.status).toBe("snoozed");
    expect(result[0]!.reasonCodes).toContain("date_threshold_due");
    expect(result[0]!.reasonCodes).toContain("snoozed");
  });

  it("disarmed row → disarmed regardless of threshold", () => {
    const r = row({ armed: 0 });
    const result = buildWatcherDeepView([r], DATE, NOW);
    expect(result[0]!.status).toBe("disarmed");
    expect(result[0]!.armed).toBe(false);
  });

  it("disarmed with snoozedUntil in future → still disarmed (disarmed wins)", () => {
    const r = row({ armed: 0, snoozedUntil: "2026-06-23T00:00:00+00:00" });
    const result = buildWatcherDeepView([r], DATE, NOW);
    expect(result[0]!.status).toBe("disarmed");
  });

  it("kind !== A → unsupported", () => {
    const r = row({ kind: "B" as WatcherRow["kind"] });
    const result = buildWatcherDeepView([r], DATE, NOW);
    expect(result[0]!.status).toBe("unsupported");
    expect(result[0]!.reasonCodes).toContain("unsupported_kind");
  });

  it("malformed rule and no valid threshold column → unsupported", () => {
    const r = row({ rule: "not-json", threshold: null });
    const result = buildWatcherDeepView([r], DATE, NOW);
    expect(result[0]!.status).toBe("unsupported");
    expect(result[0]!.reasonCodes).toContain("malformed_rule");
  });

  it("null kind → unsupported", () => {
    const r = row({ kind: null });
    const result = buildWatcherDeepView([r], DATE, NOW);
    expect(result[0]!.status).toBe("unsupported");
  });

  it("expired snooze → due (fail-open, same as evaluateWatcherA)", () => {
    const r = row({ snoozedUntil: "2026-06-21T00:00:00+00:00" }); // expired yesterday
    const result = buildWatcherDeepView([r], DATE, NOW);
    expect(result[0]!.status).toBe("due");
  });
});

describe("buildWatcherDeepView — sort order", () => {
  it("sorts due → snoozed → quiet → disarmed → unsupported", () => {
    const rows: WatcherRow[] = [
      row({ id: 5, kind: null }), // unsupported
      row({ id: 4, armed: 0 }), // disarmed
      row({ id: 3, rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-06-25" }), threshold: "2026-06-25" }), // quiet
      row({ id: 2, snoozedUntil: "2026-06-23T00:00:00+00:00" }), // snoozed
      row({ id: 1 }) // due
    ];
    const result = buildWatcherDeepView(rows, DATE, NOW);
    expect(result.map((r) => r.status)).toEqual(["due", "snoozed", "quiet", "disarmed", "unsupported"]);
  });

  it("within same status group: threshold asc, then id asc", () => {
    const rows: WatcherRow[] = [
      row({ id: 2, rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-06-18" }), threshold: "2026-06-18" }),
      row({ id: 1, rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-06-20" }), threshold: "2026-06-20" }),
      row({ id: 3, rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-06-18" }), threshold: "2026-06-18" })
    ];
    const result = buildWatcherDeepView(rows, DATE, NOW);
    expect(result.map((r) => r.id)).toEqual([2, 3, 1]); // 2026-06-18 id2 < id3, then 2026-06-20 id1
  });
});
