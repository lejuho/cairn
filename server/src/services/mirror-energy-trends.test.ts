import { describe, expect, it } from "vitest";
import { buildMirrorEnergyTrends } from "./mirror-energy-trends.js";
import type { EventRow } from "@cairn/shared";

const TODAY = "2026-06-22";

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    title: "E",
    status: "planned",
    source: "cairn",
    selfImposed: 1,
    threadId: null,
    start: "2026-06-22T09:00:00Z",
    end: "2026-06-22T11:00:00Z",
    type: null,
    location: null,
    mode: null,
    createdAt: null,
    updatedAt: null,
    ...overrides
  };
}

describe("buildMirrorEnergyTrends", () => {
  describe("date enumeration", () => {
    it("enumerates inclusive date range", () => {
      const data = buildMirrorEnergyTrends([], { today: TODAY, from: "2026-06-20", to: "2026-06-22" });
      expect(data.summary.days).toBe(3);
    });

    it("uses 30-day default window from today", () => {
      const data = buildMirrorEnergyTrends([], { today: TODAY });
      expect(data.range.to).toBe(TODAY);
      expect(data.range.from).toBe("2026-05-23");
      expect(data.summary.days).toBe(31);
    });
  });

  describe("load computation", () => {
    it("computes loadUnits as duration-hours", () => {
      // 2-hour event → 2 loadUnits
      const e = event({ start: "2026-06-22T09:00:00Z", end: "2026-06-22T11:00:00Z" });
      const data = buildMirrorEnergyTrends([e], { today: TODAY, from: "2026-06-22", to: "2026-06-22" });
      expect(data.days[0]?.loadUnits).toBe(2);
    });

    it("computes deficit when loadUnits > budgetUnits", () => {
      // 10-hour event exceeds default budget of 8
      const e = event({ start: "2026-06-22T09:00:00Z", end: "2026-06-22T19:00:00Z" });
      const data = buildMirrorEnergyTrends([e], { today: TODAY, from: "2026-06-22", to: "2026-06-22" });
      expect(data.days[0]?.deficit).toBe(true);
    });

    it("uses paramOverrides for energyBudget", () => {
      // 2-hour event, budget override to 1 → deficit
      const e = event({ start: "2026-06-22T09:00:00Z", end: "2026-06-22T11:00:00Z" });
      const data = buildMirrorEnergyTrends([e], {
        today: TODAY,
        from: "2026-06-22",
        to: "2026-06-22",
        paramOverrides: { energyBudget: 1 }
      });
      expect(data.days[0]?.deficit).toBe(true);
      expect(data.summary.budgetUnits).toBe(1);
    });

    it("rounds loadUnits to 2 decimal places", () => {
      // 1h30m = 1.5 hours exactly
      const e = event({ start: "2026-06-22T09:00:00Z", end: "2026-06-22T10:30:00Z" });
      const data = buildMirrorEnergyTrends([e], { today: TODAY, from: "2026-06-22", to: "2026-06-22" });
      expect(data.days[0]?.loadUnits).toBe(1.5);
    });
  });

  describe("cancelled/moved/late/done excluded", () => {
    it("excludes non planned/confirmed events", () => {
      const rows = [
        event({ status: "cancelled" as EventRow["status"], id: 1 }),
        event({ status: "done" as EventRow["status"], id: 2 })
      ];
      const data = buildMirrorEnergyTrends(rows, { today: TODAY, from: "2026-06-22", to: "2026-06-22" });
      expect(data.days).toHaveLength(0);
      expect(data.summary.scheduledDays).toBe(0);
    });
  });

  describe("summary aggregation", () => {
    it("counts scheduledDays correctly", () => {
      const rows = [
        event({ id: 1, start: "2026-06-21T09:00:00Z", end: "2026-06-21T11:00:00Z" }),
        event({ id: 2, start: "2026-06-22T09:00:00Z", end: "2026-06-22T11:00:00Z" })
      ];
      const data = buildMirrorEnergyTrends(rows, { today: TODAY, from: "2026-06-21", to: "2026-06-22" });
      expect(data.summary.scheduledDays).toBe(2);
    });

    it("handles zero scheduled days without NaN/Infinity", () => {
      const data = buildMirrorEnergyTrends([], { today: TODAY, from: "2026-06-21", to: "2026-06-22" });
      expect(data.summary.scheduledDays).toBe(0);
      expect(data.summary.averageScheduledLoadUnits).toBe(0);
      expect(data.summary.averageDailyLoadUnits).toBe(0);
      expect(data.summary.peakLoadUnits).toBe(0);
      expect(Number.isFinite(data.summary.averageDailyLoadUnits)).toBe(true);
    });

    it("computes deficitDays correctly", () => {
      const heavyEvent = event({ id: 1, start: "2026-06-22T09:00:00Z", end: "2026-06-22T20:00:00Z" });
      const data = buildMirrorEnergyTrends([heavyEvent], {
        today: TODAY,
        from: "2026-06-22",
        to: "2026-06-22"
      });
      expect(data.summary.deficitDays).toBe(1);
    });

    it("computes peakLoadUnits as max daily load", () => {
      const rows = [
        event({ id: 1, start: "2026-06-21T09:00:00Z", end: "2026-06-21T12:00:00Z" }), // 3h
        event({ id: 2, start: "2026-06-22T09:00:00Z", end: "2026-06-22T14:00:00Z" })  // 5h
      ];
      const data = buildMirrorEnergyTrends(rows, { today: TODAY, from: "2026-06-21", to: "2026-06-22" });
      expect(data.summary.peakLoadUnits).toBe(5);
    });

    it("computes averageDailyLoadUnits over all days", () => {
      // 1 event on day 1 (2h), nothing on day 2 → avg = 2/2 = 1
      const e = event({ id: 1, start: "2026-06-21T09:00:00Z", end: "2026-06-21T11:00:00Z" });
      const data = buildMirrorEnergyTrends([e], { today: TODAY, from: "2026-06-21", to: "2026-06-22" });
      expect(data.summary.averageDailyLoadUnits).toBe(1);
    });

    it("computes averageScheduledLoadUnits over scheduled days only", () => {
      // 2h event on day 1 only → avg scheduled = 2/1 = 2
      const e = event({ id: 1, start: "2026-06-21T09:00:00Z", end: "2026-06-21T11:00:00Z" });
      const data = buildMirrorEnergyTrends([e], { today: TODAY, from: "2026-06-21", to: "2026-06-22" });
      expect(data.summary.averageScheduledLoadUnits).toBe(2);
    });
  });

  describe("continuousExceeded", () => {
    it("sets continuousExceeded when span exceeds maxContinuous", () => {
      // 11-hour event (660 min) > default maxContinuous (600 min)
      const e = event({ start: "2026-06-22T09:00:00Z", end: "2026-06-22T20:00:00Z" });
      const data = buildMirrorEnergyTrends([e], { today: TODAY, from: "2026-06-22", to: "2026-06-22" });
      expect(data.days[0]?.continuousExceeded).toBe(true);
    });

    it("does not set continuousExceeded for short events", () => {
      const e = event({ start: "2026-06-22T09:00:00Z", end: "2026-06-22T11:00:00Z" });
      const data = buildMirrorEnergyTrends([e], { today: TODAY, from: "2026-06-22", to: "2026-06-22" });
      expect(data.days[0]?.continuousExceeded).toBe(false);
    });
  });

  describe("sampleStatus", () => {
    it("returns low_sample when scheduledDays < 3", () => {
      const rows = [
        event({ id: 1, start: "2026-06-21T09:00:00Z", end: "2026-06-21T10:00:00Z" }),
        event({ id: 2, start: "2026-06-22T09:00:00Z", end: "2026-06-22T10:00:00Z" })
      ];
      const data = buildMirrorEnergyTrends(rows, { today: TODAY, from: "2026-06-21", to: "2026-06-22" });
      expect(data.sampleStatus).toBe("low_sample");
    });

    it("returns ok when scheduledDays >= 3", () => {
      const rows = [
        event({ id: 1, start: "2026-06-20T09:00:00Z", end: "2026-06-20T10:00:00Z" }),
        event({ id: 2, start: "2026-06-21T09:00:00Z", end: "2026-06-21T10:00:00Z" }),
        event({ id: 3, start: "2026-06-22T09:00:00Z", end: "2026-06-22T10:00:00Z" })
      ];
      const data = buildMirrorEnergyTrends(rows, { today: TODAY, from: "2026-06-20", to: "2026-06-22" });
      expect(data.sampleStatus).toBe("ok");
    });
  });
});
