import { describe, expect, it } from "vitest";
import {
  MirrorLedgerCostSchema,
  MirrorLedgerDataSchema,
  MirrorLedgerQuerySchema
} from "./mirror.js";

const VALID_DATA = {
  range: { from: "2026-06-01", to: "2026-06-21" },
  summary: {
    totalChanges: 3,
    movedCount: 2,
    cancelledCount: 1,
    freeCount: 1,
    paidCount: 2,
    moneyTotal: 12000,
    socialTotal: 3,
    effortBreakdown: { none: 1, low: 1, medium: 1, high: 0, unknown: 0 }
  },
  entries: [
    {
      annotationId: 42,
      eventId: 10,
      eventTitle: "팀 회의",
      thread: { id: 1, name: "프로젝트" },
      outcome: "moved",
      reasonText: "conflict_resolution",
      reasonTags: ["conflict_resolution"],
      loggedAt: "2026-06-21 09:00:00",
      eventStart: "2026-06-21T10:00:00+09:00",
      cost: { money: 12000, social: 2, effort: "medium", window: "same_day", hasAnyCost: true }
    }
  ],
  sampleStatus: "ok"
};

describe("MirrorLedgerDataSchema", () => {
  it("parses a valid ledger payload", () => {
    expect(MirrorLedgerDataSchema.parse(VALID_DATA)).toEqual(VALID_DATA);
  });

  it("rejects an invalid outcome", () => {
    const bad = { ...VALID_DATA, entries: [{ ...VALID_DATA.entries[0], outcome: "done" }] };
    expect(MirrorLedgerDataSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid sampleStatus", () => {
    const bad = { ...VALID_DATA, sampleStatus: "great" };
    expect(MirrorLedgerDataSchema.safeParse(bad).success).toBe(false);
  });

  it("allows a null thread", () => {
    const data = { ...VALID_DATA, entries: [{ ...VALID_DATA.entries[0], thread: null }] };
    expect(MirrorLedgerDataSchema.safeParse(data).success).toBe(true);
  });
});

describe("MirrorLedgerCostSchema", () => {
  it("rejects an injected scalar score field (cost stays split)", () => {
    const withScore = { money: 0, social: 0, effort: "none", window: null, hasAnyCost: false, score: 5 };
    expect(MirrorLedgerCostSchema.safeParse(withScore).success).toBe(false);
  });

  it("rejects an unrecognized effort bucket", () => {
    const bad = { money: 0, social: 0, effort: "extreme", window: null, hasAnyCost: false };
    expect(MirrorLedgerCostSchema.safeParse(bad).success).toBe(false);
  });
});

describe("MirrorLedgerQuerySchema", () => {
  it("accepts empty query (defaults applied downstream)", () => {
    expect(MirrorLedgerQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects a non-date from", () => {
    expect(MirrorLedgerQuerySchema.safeParse({ from: "2026/06/01" }).success).toBe(false);
  });

  it("rejects an impossible date that passes shape but fails Date.parse", () => {
    expect(MirrorLedgerQuerySchema.safeParse({ from: "2026-99-99" }).success).toBe(false);
  });

  it("rejects an overflow date that Date.parse rolls over (2026-02-30)", () => {
    expect(MirrorLedgerQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(MirrorLedgerQuerySchema.safeParse({ to: "2026-06-31" }).success).toBe(false);
  });

  it("rejects a non-leap-year Feb 29 but accepts a leap-year one", () => {
    expect(MirrorLedgerQuerySchema.safeParse({ from: "2026-02-29" }).success).toBe(false);
    expect(MirrorLedgerQuerySchema.safeParse({ from: "2024-02-29" }).success).toBe(true);
  });

  it("rejects a reversed range", () => {
    expect(MirrorLedgerQuerySchema.safeParse({ from: "2026-06-21", to: "2026-06-01" }).success).toBe(false);
  });

  it("accepts a valid range", () => {
    expect(MirrorLedgerQuerySchema.safeParse({ from: "2026-06-01", to: "2026-06-21" }).success).toBe(true);
  });
});
