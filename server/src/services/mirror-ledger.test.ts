import { describe, expect, it } from "vitest";
import { buildMirrorLedger } from "./mirror-ledger.js";
import type { MirrorSourceRow } from "../repositories/mirror.js";

function row(over: Partial<MirrorSourceRow>): MirrorSourceRow {
  return {
    annotationId: 1,
    eventId: 10,
    eventTitle: "E",
    outcome: "moved",
    reasonTags: null,
    reasonText: null,
    loggedAt: "2026-06-15 09:00:00",
    eventStart: null,
    threadId: null,
    threadName: null,
    cancelMoney: 0,
    cancelSocial: 0,
    cancelEffort: "none",
    cancelWindow: null,
    ...over
  };
}

const OPTS = { from: "2026-06-01", to: "2026-06-30", today: "2026-06-30" };

describe("buildMirrorLedger — summary aggregation", () => {
  it("counts moved and cancelled separately", () => {
    const r = buildMirrorLedger(
      [
        row({ annotationId: 1, outcome: "moved" }),
        row({ annotationId: 2, outcome: "cancelled" }),
        row({ annotationId: 3, outcome: "moved" })
      ],
      OPTS
    );
    expect(r.summary.totalChanges).toBe(3);
    expect(r.summary.movedCount).toBe(2);
    expect(r.summary.cancelledCount).toBe(1);
  });

  it("sums money and social totals", () => {
    const r = buildMirrorLedger(
      [
        row({ annotationId: 1, cancelMoney: 12000, cancelSocial: 2 }),
        row({ annotationId: 2, cancelMoney: 3000, cancelSocial: 1 })
      ],
      OPTS
    );
    expect(r.summary.moneyTotal).toBe(15000);
    expect(r.summary.socialTotal).toBe(3);
  });

  it("buckets effort and covers unknown for unrecognized values", () => {
    const r = buildMirrorLedger(
      [
        row({ annotationId: 1, cancelEffort: "none" }),
        row({ annotationId: 2, cancelEffort: "low" }),
        row({ annotationId: 3, cancelEffort: "medium" }),
        row({ annotationId: 4, cancelEffort: "high" }),
        row({ annotationId: 5, cancelEffort: null }),
        row({ annotationId: 6, cancelEffort: "weird" })
      ],
      OPTS
    );
    expect(r.summary.effortBreakdown).toEqual({ none: 1, low: 1, medium: 1, high: 1, unknown: 2 });
  });
});

describe("buildMirrorLedger — free vs paid", () => {
  it("classifies zero-cost entries as free", () => {
    const r = buildMirrorLedger([row({ cancelMoney: 0, cancelSocial: 0, cancelEffort: "none" })], OPTS);
    expect(r.summary.freeCount).toBe(1);
    expect(r.summary.paidCount).toBe(0);
    expect(r.entries[0]!.cost.hasAnyCost).toBe(false);
  });

  it("classifies money-only, social-only, and effort-only as paid", () => {
    const r = buildMirrorLedger(
      [
        row({ annotationId: 1, cancelMoney: 500, cancelSocial: 0, cancelEffort: "none" }),
        row({ annotationId: 2, cancelMoney: 0, cancelSocial: 2, cancelEffort: "none" }),
        row({ annotationId: 3, cancelMoney: 0, cancelSocial: 0, cancelEffort: "low" })
      ],
      OPTS
    );
    expect(r.summary.paidCount).toBe(3);
    expect(r.summary.freeCount).toBe(0);
  });

  it("free + paid always equals totalChanges", () => {
    const r = buildMirrorLedger(
      [
        row({ annotationId: 1, cancelEffort: "none" }),
        row({ annotationId: 2, cancelMoney: 100 }),
        row({ annotationId: 3, cancelEffort: "weird" }) // unrecognized → paid (not none/empty)
      ],
      OPTS
    );
    expect(r.summary.freeCount + r.summary.paidCount).toBe(r.summary.totalChanges);
    expect(r.summary.paidCount).toBe(2);
  });
});

describe("buildMirrorLedger — reasonTags fail-open", () => {
  it("parses a valid JSON array", () => {
    const r = buildMirrorLedger([row({ reasonTags: '["conflict_resolution","sick"]' })], OPTS);
    expect(r.entries[0]!.reasonTags).toEqual(["conflict_resolution", "sick"]);
  });

  it("returns [] for malformed JSON without throwing", () => {
    const r = buildMirrorLedger([row({ reasonTags: "{not json" })], OPTS);
    expect(r.entries[0]!.reasonTags).toEqual([]);
  });

  it("returns [] for non-array JSON and drops non-string members", () => {
    const obj = buildMirrorLedger([row({ reasonTags: '{"a":1}' })], OPTS);
    expect(obj.entries[0]!.reasonTags).toEqual([]);
    const mixed = buildMirrorLedger([row({ reasonTags: '["ok",1,null]' })], OPTS);
    expect(mixed.entries[0]!.reasonTags).toEqual(["ok"]);
  });
});

describe("buildMirrorLedger — sample threshold", () => {
  it("marks low_sample below 3 changes", () => {
    const r = buildMirrorLedger([row({ annotationId: 1 }), row({ annotationId: 2 })], OPTS);
    expect(r.sampleStatus).toBe("low_sample");
  });

  it("marks ok at 3 or more changes", () => {
    const r = buildMirrorLedger(
      [row({ annotationId: 1 }), row({ annotationId: 2 }), row({ annotationId: 3 })],
      OPTS
    );
    expect(r.sampleStatus).toBe("ok");
  });
});

describe("buildMirrorLedger — filtering and ordering", () => {
  it("excludes non moved/cancelled outcomes", () => {
    const r = buildMirrorLedger(
      [row({ annotationId: 1, outcome: "done" }), row({ annotationId: 2, outcome: "late" })],
      OPTS
    );
    expect(r.entries).toHaveLength(0);
  });

  it("excludes rows with missing event join", () => {
    const r = buildMirrorLedger([row({ eventId: null, eventTitle: null })], OPTS);
    expect(r.entries).toHaveLength(0);
  });

  it("excludes rows outside the date range and empty loggedAt", () => {
    const r = buildMirrorLedger(
      [
        row({ annotationId: 1, loggedAt: "2026-05-31 23:00:00" }), // before from
        row({ annotationId: 2, loggedAt: "2026-07-01 00:00:00" }), // after to
        row({ annotationId: 3, loggedAt: "" }), // undated
        row({ annotationId: 4, loggedAt: "2026-06-15 12:00:00" }) // inside
      ],
      OPTS
    );
    expect(r.entries.map((e) => e.annotationId)).toEqual([4]);
  });

  it("orders newest first, annotation id desc as tie-breaker", () => {
    const r = buildMirrorLedger(
      [
        row({ annotationId: 1, loggedAt: "2026-06-10 09:00:00" }),
        row({ annotationId: 2, loggedAt: "2026-06-20 09:00:00" }),
        row({ annotationId: 3, loggedAt: "2026-06-20 09:00:00" })
      ],
      OPTS
    );
    expect(r.entries.map((e) => e.annotationId)).toEqual([3, 2, 1]);
  });

  it("defaults to a 30-day window ending at today when no range is given", () => {
    const r = buildMirrorLedger([], { today: "2026-06-30" });
    expect(r.range).toEqual({ from: "2026-05-31", to: "2026-06-30" });
  });

  it("attaches thread only when both id and name are present", () => {
    const withThread = buildMirrorLedger([row({ threadId: 5, threadName: "P" })], OPTS);
    expect(withThread.entries[0]!.thread).toEqual({ id: 5, name: "P" });
    const noThread = buildMirrorLedger([row({ threadId: null, threadName: null })], OPTS);
    expect(noThread.entries[0]!.thread).toBeNull();
  });
});
