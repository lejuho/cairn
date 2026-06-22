import { describe, expect, it } from "vitest";
import { evaluateWatcherA } from "./watchers.js";
import type { WatcherRow } from "@cairn/shared";

const DATE = "2026-06-22";
const NOW = "2026-06-22T09:00:00+00:00";

function row(overrides: Partial<WatcherRow> = {}): WatcherRow {
  return {
    id: 1,
    label: "여권 갱신",
    category: null,
    kind: "A",
    armed: 1,
    rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-06-22" }),
    threshold: "2026-06-22",
    lastFired: null,
    snoozedUntil: null,
    createdAt: null,
    ...overrides
  };
}

describe("evaluateWatcherA", () => {
  describe("filtering", () => {
    it("surfaces a due date-threshold watcher", () => {
      const result = evaluateWatcherA([row()], DATE, NOW);
      expect(result).toHaveLength(1);
      expect(result[0]?.label).toBe("여권 갱신");
    });

    it("hides future threshold", () => {
      const result = evaluateWatcherA(
        [row({ rule: JSON.stringify({ type: "date_threshold", fireOn: "2026-12-31" }), threshold: "2026-12-31" })],
        DATE, NOW
      );
      expect(result).toHaveLength(0);
    });

    it("hides armed=0 watcher", () => {
      expect(evaluateWatcherA([row({ armed: 0 })], DATE, NOW)).toHaveLength(0);
    });

    it("hides armed=null watcher", () => {
      expect(evaluateWatcherA([row({ armed: null })], DATE, NOW)).toHaveLength(0);
    });

    it("hides wrong kind", () => {
      expect(evaluateWatcherA([row({ kind: "B" as WatcherRow["kind"] })], DATE, NOW)).toHaveLength(0);
    });

    it("hides when future snooze active", () => {
      const result = evaluateWatcherA(
        [row({ snoozedUntil: "2026-12-31T23:59:59+00:00" })],
        DATE, NOW
      );
      expect(result).toHaveLength(0);
    });

    it("surfaces when snooze has expired", () => {
      const result = evaluateWatcherA(
        [row({ snoozedUntil: "2026-01-01T00:00:00+00:00" })],
        DATE, NOW
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("rule fallback", () => {
    it("falls back to threshold column when rule is null", () => {
      const result = evaluateWatcherA([row({ rule: null, threshold: "2026-06-22" })], DATE, NOW);
      expect(result).toHaveLength(1);
      expect(result[0]?.threshold).toBe("2026-06-22");
    });

    it("falls back to threshold column when rule is malformed JSON", () => {
      const result = evaluateWatcherA([row({ rule: "not-json", threshold: "2026-06-22" })], DATE, NOW);
      expect(result).toHaveLength(1);
    });

    it("falls back to threshold when rule has unsupported type", () => {
      const result = evaluateWatcherA(
        [row({ rule: JSON.stringify({ type: "keyword" }), threshold: "2026-06-22" })],
        DATE, NOW
      );
      expect(result).toHaveLength(1);
    });

    it("hides when malformed rule and no valid threshold", () => {
      expect(evaluateWatcherA([row({ rule: "bad", threshold: null })], DATE, NOW)).toHaveLength(0);
    });

    it("hides when malformed rule and threshold is overflow date", () => {
      // 2026-02-30 rolls to 2026-03-02 — must be caught by round-trip check
      expect(evaluateWatcherA([row({ rule: null, threshold: "2026-02-30" })], DATE, NOW)).toHaveLength(0);
    });
  });

  describe("daysOverdue", () => {
    it("is 0 when threshold equals date", () => {
      const result = evaluateWatcherA([row({ threshold: "2026-06-22", rule: null })], DATE, NOW);
      expect(result[0]?.daysOverdue).toBe(0);
    });

    it("is positive when threshold is in the past", () => {
      const result = evaluateWatcherA([row({ threshold: "2026-06-20", rule: null })], DATE, NOW);
      expect(result[0]?.daysOverdue).toBe(2);
    });

    it("is never negative", () => {
      const result = evaluateWatcherA([row({ threshold: "2026-06-22", rule: null })], DATE, NOW);
      expect(result[0]?.daysOverdue).toBeGreaterThanOrEqual(0);
    });

    it("emits 'N일 지난 watcher야' for overdue", () => {
      const result = evaluateWatcherA([row({ threshold: "2026-06-20", rule: null })], DATE, NOW);
      expect(result[0]?.message).toBe("2일 지난 watcher야");
    });

    it("emits '오늘 확인할 watcher야' for same-day", () => {
      const result = evaluateWatcherA([row({ threshold: "2026-06-22", rule: null })], DATE, NOW);
      expect(result[0]?.message).toBe("오늘 확인할 watcher야");
    });
  });

  describe("sorting", () => {
    it("sorts threshold asc, id asc for ties", () => {
      const rows = [
        row({ id: 3, threshold: "2026-06-21", rule: null }),
        row({ id: 1, threshold: "2026-06-22", rule: null }),
        row({ id: 2, threshold: "2026-06-21", rule: null })
      ];
      const result = evaluateWatcherA(rows, DATE, NOW);
      expect(result.map((b) => b.id)).toEqual([2, 3, 1]);
    });
  });

  describe("reasonCodes", () => {
    it("emits date_threshold_due reason", () => {
      const result = evaluateWatcherA([row()], DATE, NOW);
      expect(result[0]?.reasonCodes).toEqual(["date_threshold_due"]);
    });
  });
});
