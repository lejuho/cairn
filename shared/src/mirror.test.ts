import { describe, expect, it } from "vitest";
import {
  MirrorAutomationNeedItemSchema,
  MirrorDiaryDataSchema,
  MirrorDiaryEntrySchema,
  MirrorDiaryQuerySchema,
  MirrorEnergyTrendDataSchema,
  MirrorEnergyTrendDaySchema,
  MirrorEnergyTrendQuerySchema,
  MirrorTransitionFrictionQuerySchema,
  MirrorTransitionFrictionDataSchema,
  MirrorTransitionFrictionDaySchema,
  MirrorEnergyTrendSummarySchema,
  MirrorLedgerCostSchema,
  MirrorLedgerDataSchema,
  MirrorLedgerQuerySchema,
  MirrorPatternBucketSchema,
  MirrorPatternThreadBucketSchema,
  MirrorPatternsDataSchema,
  MirrorPatternsQuerySchema
} from "./mirror.js";

const VALID_AUTOMATION_NEED_ITEM = {
  watcherId: 7,
  label: "전기요금",
  category: "bill",
  sourceStability: "stable",
  manualLogCount: 4,
  signalSeenCount: 10,
  missedSignalCount: 6,
  missRate: 0.6,
  level: "consider_lightweight",
  reasonCodes: ["high_miss_rate"],
  reasons: ["놓친 신호가 많습니다"]
};

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

const VALID_BUCKET = {
  key: "monday",
  label: "월요일",
  total: 4,
  outcomes: { done: 2, moved: 1, cancelled: 0, late: 1 },
  slipCount: 2,
  slipRatio: 0.5,
  sampleStatus: "ok" as const
};

const VALID_PATTERNS_DATA = {
  range: { from: "2026-06-01", to: "2026-06-30" },
  totals: { annotations: 4, done: 2, moved: 1, cancelled: 0, late: 1, slipCount: 2 },
  weekday: [VALID_BUCKET],
  type: [{ ...VALID_BUCKET, key: "meet", label: "meet" }],
  thread: [
    {
      key: "thread:1",
      thread: { id: 1, name: "프로젝트" },
      label: "프로젝트",
      total: 4,
      outcomes: { done: 2, moved: 1, cancelled: 0, late: 1 },
      slipCount: 2,
      slipRatio: 0.5,
      sampleStatus: "ok" as const
    }
  ],
  sampleStatus: "ok" as const
};

describe("MirrorPatternsDataSchema", () => {
  it("parses a valid patterns payload", () => {
    expect(MirrorPatternsDataSchema.parse(VALID_PATTERNS_DATA)).toEqual(VALID_PATTERNS_DATA);
  });

  it("rejects an invalid sampleStatus", () => {
    expect(MirrorPatternsDataSchema.safeParse({ ...VALID_PATTERNS_DATA, sampleStatus: "great" }).success).toBe(false);
  });

  it("rejects a bucket with a missing outcome key", () => {
    const badBucket = { ...VALID_BUCKET, outcomes: { done: 1, moved: 1, cancelled: 0 } };
    expect(MirrorPatternsDataSchema.safeParse({ ...VALID_PATTERNS_DATA, weekday: [badBucket] }).success).toBe(false);
  });

  it("rejects thread:null bucket with null thread", () => {
    const nullThread = { ...VALID_PATTERNS_DATA.thread[0]!, key: "thread:null", thread: null, label: "스레드 없음" };
    expect(MirrorPatternsDataSchema.safeParse({ ...VALID_PATTERNS_DATA, thread: [nullThread] }).success).toBe(true);
  });
});

describe("MirrorPatternBucketSchema", () => {
  it("rejects an injected score field (strict)", () => {
    expect(MirrorPatternBucketSchema.safeParse({ ...VALID_BUCKET, score: 9 }).success).toBe(false);
  });

  it("rejects a recommendation field (strict)", () => {
    expect(MirrorPatternBucketSchema.safeParse({ ...VALID_BUCKET, recommendation: "줄여야 해" }).success).toBe(false);
  });

  it("accepts low_sample sampleStatus", () => {
    expect(MirrorPatternBucketSchema.safeParse({ ...VALID_BUCKET, sampleStatus: "low_sample" }).success).toBe(true);
  });
});

describe("MirrorPatternThreadBucketSchema", () => {
  it("rejects an injected score field (strict)", () => {
    const b = { ...VALID_PATTERNS_DATA.thread[0]!, score: 1 };
    expect(MirrorPatternThreadBucketSchema.safeParse(b).success).toBe(false);
  });
});

describe("MirrorPatternsQuerySchema", () => {
  it("accepts empty query", () => {
    expect(MirrorPatternsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects a bad format date", () => {
    expect(MirrorPatternsQuerySchema.safeParse({ from: "2026/06/01" }).success).toBe(false);
  });

  it("rejects an impossible date (2026-99-99)", () => {
    expect(MirrorPatternsQuerySchema.safeParse({ from: "2026-99-99" }).success).toBe(false);
  });

  it("rejects an overflow date (2026-02-30)", () => {
    expect(MirrorPatternsQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
  });

  it("rejects a reversed range", () => {
    expect(MirrorPatternsQuerySchema.safeParse({ from: "2026-06-30", to: "2026-06-01" }).success).toBe(false);
  });

  it("accepts a valid range", () => {
    expect(MirrorPatternsQuerySchema.safeParse({ from: "2026-06-01", to: "2026-06-30" }).success).toBe(true);
  });
});

const VALID_TREND_DAY = {
  date: "2026-06-21",
  eventCount: 2,
  loadUnits: 5.5,
  budgetUnits: 8,
  remainingUnits: 2.5,
  deficit: false,
  continuousExceeded: false
};

const VALID_TREND_DATA = {
  range: { from: "2026-06-01", to: "2026-06-30" },
  summary: {
    days: 30,
    scheduledDays: 5,
    deficitDays: 1,
    averageDailyLoadUnits: 1.2,
    averageScheduledLoadUnits: 7.2,
    peakLoadUnits: 9.5,
    budgetUnits: 8,
    sampleStatus: "ok" as const
  },
  days: [VALID_TREND_DAY],
  sampleStatus: "ok" as const
};

describe("MirrorEnergyTrendDataSchema", () => {
  it("parses a valid energy trend payload", () => {
    expect(MirrorEnergyTrendDataSchema.parse(VALID_TREND_DATA)).toEqual(VALID_TREND_DATA);
  });

  it("rejects an invalid sampleStatus", () => {
    expect(MirrorEnergyTrendDataSchema.safeParse({ ...VALID_TREND_DATA, sampleStatus: "great" }).success).toBe(false);
  });
});

describe("MirrorEnergyTrendDaySchema", () => {
  it("rejects an injected score field (strict)", () => {
    expect(MirrorEnergyTrendDaySchema.safeParse({ ...VALID_TREND_DAY, score: 9 }).success).toBe(false);
  });

  it("rejects a recommendation field (strict)", () => {
    expect(MirrorEnergyTrendDaySchema.safeParse({ ...VALID_TREND_DAY, recommendation: "줄여야 해" }).success).toBe(false);
  });
});

describe("MirrorEnergyTrendSummarySchema", () => {
  it("rejects an injected score field (strict)", () => {
    expect(MirrorEnergyTrendSummarySchema.safeParse({ ...VALID_TREND_DATA.summary, score: 1 }).success).toBe(false);
  });
});

describe("MirrorEnergyTrendQuerySchema", () => {
  it("accepts empty query", () => {
    expect(MirrorEnergyTrendQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects a bad format date", () => {
    expect(MirrorEnergyTrendQuerySchema.safeParse({ from: "2026/06/01" }).success).toBe(false);
  });

  it("rejects an impossible date (2026-99-99)", () => {
    expect(MirrorEnergyTrendQuerySchema.safeParse({ from: "2026-99-99" }).success).toBe(false);
  });

  it("rejects a reversed range", () => {
    expect(MirrorEnergyTrendQuerySchema.safeParse({ from: "2026-06-30", to: "2026-06-01" }).success).toBe(false);
  });

  it("accepts exactly 90 inclusive days (diff=89)", () => {
    // 2026-01-01 to 2026-03-31: Jan(31)+Feb(28)+Mar(30)=89 diff → 90 inclusive
    expect(MirrorEnergyTrendQuerySchema.safeParse({ from: "2026-01-01", to: "2026-03-31" }).success).toBe(true);
  });

  it("rejects 91 inclusive days (diff=90)", () => {
    // 2026-01-01 to 2026-04-01: Jan(31)+Feb(28)+Mar(31)=90 diff → 91 inclusive
    expect(MirrorEnergyTrendQuerySchema.safeParse({ from: "2026-01-01", to: "2026-04-01" }).success).toBe(false);
  });

  it("accepts a valid range within 90 days", () => {
    expect(MirrorEnergyTrendQuerySchema.safeParse({ from: "2026-06-01", to: "2026-06-30" }).success).toBe(true);
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

describe("MirrorAutomationNeedItemSchema", () => {
  it("accepts a fully populated item", () => {
    expect(MirrorAutomationNeedItemSchema.safeParse(VALID_AUTOMATION_NEED_ITEM).success).toBe(true);
  });

  it("rejects an item missing reasons", () => {
    const { reasons, ...withoutReasons } = VALID_AUTOMATION_NEED_ITEM;
    void reasons;
    expect(MirrorAutomationNeedItemSchema.safeParse(withoutReasons).success).toBe(false);
  });

  it("rejects a non-string entry in reasons", () => {
    expect(
      MirrorAutomationNeedItemSchema.safeParse({ ...VALID_AUTOMATION_NEED_ITEM, reasons: [1] }).success
    ).toBe(false);
  });

  it("rejects an injected unknown field (strict)", () => {
    expect(
      MirrorAutomationNeedItemSchema.safeParse({ ...VALID_AUTOMATION_NEED_ITEM, recommendation: "자동화하세요" })
        .success
    ).toBe(false);
  });
});

const VALID_DIARY_ENTRY = {
  annotationId: 1,
  eventId: 10,
  eventTitle: "팀 회의",
  eventStart: "2026-06-21T10:00:00+09:00",
  thread: { id: 1, name: "프로젝트" },
  outcome: "moved",
  reasonText: "장소 변경",
  reasonTags: ["conflict_resolution"],
  loggedAt: "2026-06-21 09:00:00",
  depth: "semi_auto" as const,
  contextLabel: "팀 회의 / 이동"
};

const VALID_DIARY_DATA = {
  range: { from: "2026-06-01", to: "2026-06-21" },
  days: [
    {
      date: "2026-06-21",
      headline: "장소 변경",
      entries: [VALID_DIARY_ENTRY]
    }
  ],
  sampleStatus: "ok" as const
};

describe("MirrorDiaryEntrySchema", () => {
  it("accepts a valid entry with thread", () => {
    expect(MirrorDiaryEntrySchema.safeParse(VALID_DIARY_ENTRY).success).toBe(true);
  });

  it("accepts a null thread and null eventStart", () => {
    expect(
      MirrorDiaryEntrySchema.safeParse({ ...VALID_DIARY_ENTRY, thread: null, eventStart: null }).success
    ).toBe(true);
  });

  it("rejects an invalid depth", () => {
    expect(MirrorDiaryEntrySchema.safeParse({ ...VALID_DIARY_ENTRY, depth: "manual" }).success).toBe(false);
  });

  it("rejects an injected score field (strict)", () => {
    expect(MirrorDiaryEntrySchema.safeParse({ ...VALID_DIARY_ENTRY, score: 9 }).success).toBe(false);
  });

  it("rejects an injected recommendation field (strict)", () => {
    expect(MirrorDiaryEntrySchema.safeParse({ ...VALID_DIARY_ENTRY, recommendation: "더 잘해" }).success).toBe(false);
  });

  it("rejects an injected advice field (strict)", () => {
    expect(MirrorDiaryEntrySchema.safeParse({ ...VALID_DIARY_ENTRY, advice: "노력해" }).success).toBe(false);
  });
});

describe("MirrorDiaryDataSchema", () => {
  it("accepts a valid diary payload", () => {
    expect(MirrorDiaryDataSchema.safeParse(VALID_DIARY_DATA).success).toBe(true);
  });

  it("accepts empty days array", () => {
    expect(MirrorDiaryDataSchema.safeParse({ ...VALID_DIARY_DATA, days: [] }).success).toBe(true);
  });

  it("rejects an invalid sampleStatus", () => {
    expect(MirrorDiaryDataSchema.safeParse({ ...VALID_DIARY_DATA, sampleStatus: "great" }).success).toBe(false);
  });
});

describe("MirrorDiaryQuerySchema", () => {
  it("accepts empty query", () => {
    expect(MirrorDiaryQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects an overflow date (2026-02-30)", () => {
    expect(MirrorDiaryQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
  });

  it("rejects a reversed range", () => {
    expect(MirrorDiaryQuerySchema.safeParse({ from: "2026-06-30", to: "2026-06-01" }).success).toBe(false);
  });

  it("accepts exactly 90 inclusive days (diff=89)", () => {
    expect(MirrorDiaryQuerySchema.safeParse({ from: "2026-01-01", to: "2026-03-31" }).success).toBe(true);
  });

  it("rejects 91 inclusive days (diff=90)", () => {
    expect(MirrorDiaryQuerySchema.safeParse({ from: "2026-01-01", to: "2026-04-01" }).success).toBe(false);
  });
});

describe("MirrorTransitionFrictionQuerySchema", () => {
  it("accepts empty (defaults applied downstream)", () => {
    expect(MirrorTransitionFrictionQuerySchema.safeParse({}).success).toBe(true);
  });
  it("accepts a valid from<=to range", () => {
    expect(MirrorTransitionFrictionQuerySchema.safeParse({ from: "2026-06-01", to: "2026-06-20" }).success).toBe(true);
  });
  it("rejects reversed range", () => {
    expect(MirrorTransitionFrictionQuerySchema.safeParse({ from: "2026-06-20", to: "2026-06-01" }).success).toBe(false);
  });
  it("rejects malformed date", () => {
    expect(MirrorTransitionFrictionQuerySchema.safeParse({ from: "2026-6-1", to: "2026-06-20" }).success).toBe(false);
  });
  it("rejects a range longer than 90 inclusive days", () => {
    expect(MirrorTransitionFrictionQuerySchema.safeParse({ from: "2026-01-01", to: "2026-06-01" }).success).toBe(false);
  });
});

describe("MirrorTransitionFrictionDaySchema / DataSchema (strict)", () => {
  const DAY = {
    date: "2026-06-20", eventCount: 3, transitionPairs: 2,
    sameThreadPairs: 1, contextPairs: 0, unrelatedPairs: 1, missingThreadPairs: 0,
    lowTransitionPairs: 0, highTransitionPairs: 1, unknownTransitionPairs: 0,
    outcomes: { done: 1, moved: 0, cancelled: 0, late: 0 },
    energy: { entryCount: 1, averageEnergyAtTime: 3.5 },
    sampleStatus: "ok", reasonCodes: ["friction_high_present"]
  };

  it("accepts a valid day", () => {
    expect(MirrorTransitionFrictionDaySchema.safeParse(DAY).success).toBe(true);
  });
  it("accepts null averageEnergyAtTime when no energy entries", () => {
    expect(MirrorTransitionFrictionDaySchema.safeParse({ ...DAY, energy: { entryCount: 0, averageEnergyAtTime: null } }).success).toBe(true);
  });
  it("rejects injected score/recommendation/coefficient/tune/apply fields (strict)", () => {
    for (const inj of [{ score: 9 }, { riskScore: 1 }, { recommendation: "x" }, { advice: "y" }, { action: "apply" }, { apply: true }, { tune: 1 }, { coefficient: 0.5 }]) {
      expect(MirrorTransitionFrictionDaySchema.safeParse({ ...DAY, ...inj }).success).toBe(false);
    }
  });

  it("accepts a full data envelope", () => {
    const data = {
      range: { from: "2026-05-21", to: "2026-06-20" },
      summary: { days: 31, activeDays: 1, totalTransitionPairs: 2, lowTransitionPairs: 0, highTransitionPairs: 1, unknownTransitionPairs: 0, lowSampleDays: 0, sampleStatus: "ok" },
      days: [DAY]
    };
    expect(MirrorTransitionFrictionDataSchema.safeParse(data).success).toBe(true);
  });
  it("rejects injected top-level score field (strict)", () => {
    const data = {
      range: { from: "2026-05-21", to: "2026-06-20" },
      summary: { days: 31, activeDays: 1, totalTransitionPairs: 2, lowTransitionPairs: 0, highTransitionPairs: 1, unknownTransitionPairs: 0, lowSampleDays: 0, sampleStatus: "ok" },
      days: [DAY], riskScore: 5
    };
    expect(MirrorTransitionFrictionDataSchema.safeParse(data).success).toBe(false);
  });
});
