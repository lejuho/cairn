import { describe, expect, it } from "vitest";
import { buildMirrorPatterns } from "./mirror-patterns.js";
import type { MirrorSourceRow } from "../repositories/mirror.js";

const TODAY = "2026-06-22";

function row(overrides: Partial<MirrorSourceRow> = {}): MirrorSourceRow {
  return {
    annotationId: 1,
    eventId: 1,
    eventTitle: "이벤트",
    eventType: "meet",
    outcome: "done",
    reasonTags: null,
    reasonText: null,
    loggedAt: "2026-06-22 09:00:00",
    eventStart: "2026-06-22T10:00:00+09:00",
    threadId: null,
    threadName: null,
    cancelMoney: 0,
    cancelSocial: 0,
    cancelEffort: "none",
    cancelWindow: null,
    ...overrides
  };
}

describe("buildMirrorPatterns", () => {
  describe("filtering", () => {
    it("excludes rows with missing event join", () => {
      const r = row({ eventId: null });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.totals.annotations).toBe(0);
    });

    it("excludes rows with empty loggedAt", () => {
      const r = row({ loggedAt: "" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.totals.annotations).toBe(0);
    });

    it("excludes rows outside the date range", () => {
      const r = row({ loggedAt: "2026-05-31 23:00:00" });
      const data = buildMirrorPatterns([r], { today: TODAY, from: "2026-06-01", to: "2026-06-30" });
      expect(data.totals.annotations).toBe(0);
    });

    it("includes all four outcomes", () => {
      const rows = [
        row({ outcome: "done", annotationId: 1 }),
        row({ outcome: "moved", annotationId: 2 }),
        row({ outcome: "cancelled", annotationId: 3 }),
        row({ outcome: "late", annotationId: 4 })
      ];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      expect(data.totals.done).toBe(1);
      expect(data.totals.moved).toBe(1);
      expect(data.totals.cancelled).toBe(1);
      expect(data.totals.late).toBe(1);
      expect(data.totals.annotations).toBe(4);
    });

    it("excludes unknown outcome strings", () => {
      const r = row({ outcome: "pending" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.totals.annotations).toBe(0);
    });
  });

  describe("totals", () => {
    it("computes slipCount = moved + cancelled + late", () => {
      const rows = [
        row({ outcome: "moved", annotationId: 1 }),
        row({ outcome: "cancelled", annotationId: 2 }),
        row({ outcome: "late", annotationId: 3 }),
        row({ outcome: "done", annotationId: 4 })
      ];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      expect(data.totals.slipCount).toBe(3);
    });
  });

  describe("weekday grouping", () => {
    it("groups by events.start weekday (UTC)", () => {
      // 2026-06-22 is a Monday
      const r = row({ eventStart: "2026-06-22T10:00:00+09:00" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.weekday[0]?.key).toBe("monday");
      expect(data.weekday[0]?.total).toBe(1);
    });

    it("puts null events.start in unknown bucket", () => {
      const r = row({ eventStart: null });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.weekday[0]?.key).toBe("unknown");
    });

    it("puts malformed events.start in unknown bucket", () => {
      const r = row({ eventStart: "not-a-date" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.weekday[0]?.key).toBe("unknown");
    });

    it("puts shape-valid overflow start (2026-02-30) in unknown bucket", () => {
      const r = row({ eventStart: "2026-02-30T10:00:00Z" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.weekday[0]?.key).toBe("unknown");
    });

    it("puts shape-valid overflow start (2026-06-31) in unknown bucket", () => {
      const r = row({ eventStart: "2026-06-31T10:00:00Z" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.weekday[0]?.key).toBe("unknown");
    });

    it("preserves Mon→Sun→unknown sort order", () => {
      const rows = [
        row({ eventStart: "2026-06-21T10:00:00Z", annotationId: 1 }), // Sunday
        row({ eventStart: "2026-06-22T10:00:00Z", annotationId: 2 }), // Monday
        row({ eventStart: null, annotationId: 3 })                     // unknown
      ];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      const keys = data.weekday.map((b) => b.key);
      expect(keys.indexOf("monday")).toBeLessThan(keys.indexOf("sunday"));
      expect(keys.indexOf("sunday")).toBeLessThan(keys.indexOf("unknown"));
    });
  });

  describe("type grouping", () => {
    it("groups by events.type", () => {
      const rows = [
        row({ eventType: "meet", annotationId: 1 }),
        row({ eventType: "meet", annotationId: 2 }),
        row({ eventType: "focus", annotationId: 3 })
      ];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      const meet = data.type.find((b) => b.key === "meet");
      expect(meet?.total).toBe(2);
    });

    it("puts null/blank type in unknown bucket", () => {
      const rows = [
        row({ eventType: null, annotationId: 1 }),
        row({ eventType: "", annotationId: 2 })
      ];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      expect(data.type[0]?.key).toBe("unknown");
      expect(data.type[0]?.total).toBe(2);
    });

    it("sorts type by total desc then label asc", () => {
      const rows = [
        row({ eventType: "meet", annotationId: 1 }),
        row({ eventType: "meet", annotationId: 2 }),
        row({ eventType: "focus", annotationId: 3 })
      ];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      expect(data.type[0]?.key).toBe("meet");
      expect(data.type[1]?.key).toBe("focus");
    });
  });

  describe("thread grouping", () => {
    it("groups by thread_id with thread info attached", () => {
      const rows = [
        row({ threadId: 1, threadName: "프로젝트", annotationId: 1 }),
        row({ threadId: 1, threadName: "프로젝트", annotationId: 2 })
      ];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      const bucket = data.thread[0];
      expect(bucket?.key).toBe("thread:1");
      expect(bucket?.thread).toEqual({ id: 1, name: "프로젝트" });
      expect(bucket?.total).toBe(2);
    });

    it("uses thread:null key and null thread for threadless events", () => {
      const r = row({ threadId: null, threadName: null });
      const data = buildMirrorPatterns([r], { today: TODAY });
      const bucket = data.thread[0];
      expect(bucket?.key).toBe("thread:null");
      expect(bucket?.thread).toBeNull();
      expect(bucket?.label).toBe("스레드 없음");
    });
  });

  describe("slipRatio", () => {
    it("rounds to 3 decimal places", () => {
      const rows = [
        row({ outcome: "moved", annotationId: 1 }),
        row({ outcome: "done", annotationId: 2 }),
        row({ outcome: "done", annotationId: 3 })
      ];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      // 1 slip / 3 total = 0.333
      expect(data.weekday[0]?.slipRatio).toBe(0.333);
    });

    it("returns 0 slipRatio when no slips", () => {
      const r = row({ outcome: "done" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.weekday[0]?.slipRatio).toBe(0);
    });
  });

  describe("sampleStatus", () => {
    it("returns low_sample when total < 3", () => {
      const rows = [row({ annotationId: 1 }), row({ annotationId: 2 })];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      expect(data.sampleStatus).toBe("low_sample");
    });

    it("returns ok when total >= 3", () => {
      const rows = [row({ annotationId: 1 }), row({ annotationId: 2 }), row({ annotationId: 3 })];
      const data = buildMirrorPatterns(rows, { today: TODAY });
      expect(data.sampleStatus).toBe("ok");
    });

    it("sets low_sample per bucket when bucket total < 3", () => {
      const r = row({ eventType: "meet" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.type[0]?.sampleStatus).toBe("low_sample");
    });
  });

  describe("default range", () => {
    it("applies 30-day default window from today", () => {
      const r = row({ loggedAt: "2026-06-22 09:00:00" });
      const data = buildMirrorPatterns([r], { today: TODAY });
      expect(data.range.to).toBe(TODAY);
      expect(data.range.from).toBe("2026-05-23");
    });
  });
});
