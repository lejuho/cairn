import { describe, expect, it } from "vitest";
import {
  CreateReversePlanWatcherRequestSchema,
  PatchWatcherArmedRequestSchema,
  WatcherABubbleSchema,
  WatcherDeepRowSchema,
  WatcherDeepStatusSchema,
  WatcherListResponseDataSchema,
  WatchersQuerySchema
} from "./watchers.js";

const VALID_BUBBLE = {
  id: 1,
  label: "여권 갱신",
  category: "procurement",
  kind: "A" as const,
  threshold: "2026-06-22",
  snoozedUntil: null,
  daysOverdue: 0,
  reasonCodes: ["date_threshold_due" as const],
  message: "오늘 확인할 watcher야"
};

describe("WatcherABubbleSchema", () => {
  it("parses a valid bubble", () => {
    const result = WatcherABubbleSchema.safeParse(VALID_BUBBLE);
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict)", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, score: 99 });
    expect(result.success).toBe(false);
  });

  it("rejects advice/recommendation fields", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, recommendation: "구매해" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid reason code", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, reasonCodes: ["unknown_code"] });
    expect(result.success).toBe(false);
  });

  it("requires kind to be A", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, kind: "B" });
    expect(result.success).toBe(false);
  });

  it("rejects negative daysOverdue", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, daysOverdue: -1 });
    expect(result.success).toBe(false);
  });

  it("allows daysOverdue > 0 for overdue watchers", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, daysOverdue: 5 });
    expect(result.success).toBe(true);
  });

  it("allows null label", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, label: null });
    expect(result.success).toBe(true);
  });

  it("allows non-null snoozedUntil", () => {
    const result = WatcherABubbleSchema.safeParse({
      ...VALID_BUBBLE,
      snoozedUntil: "2026-06-30T00:00:00+09:00"
    });
    expect(result.success).toBe(true);
  });

  it("accepts reverse_plan_due reasonCode", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, reasonCodes: ["reverse_plan_due"] });
    expect(result.success).toBe(true);
  });

  it("rejects unknown reasonCode", () => {
    const result = WatcherABubbleSchema.safeParse({ ...VALID_BUBBLE, reasonCodes: ["ai_suggested"] });
    expect(result.success).toBe(false);
  });
});

const BASE_DEEP_ROW = {
  id: 1,
  category: "travel",
  label: "여권 갱신",
  kind: "A",
  armed: true,
  threshold: "2026-06-20",
  snoozedUntil: null,
  status: "due",
  daysOverdue: 2,
  daysUntil: null,
  message: "2일 지난 watcher야",
  reasonCodes: ["date_threshold_due"]
};

describe("WatcherDeepStatusSchema", () => {
  it("accepts all five status values", () => {
    for (const s of ["due", "quiet", "snoozed", "disarmed", "unsupported"] as const) {
      expect(WatcherDeepStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown status", () => {
    expect(WatcherDeepStatusSchema.safeParse("pending").success).toBe(false);
  });
});

describe("WatcherDeepRowSchema", () => {
  it("parses valid due row", () => {
    const r = WatcherDeepRowSchema.parse(BASE_DEEP_ROW);
    expect(r.status).toBe("due");
    expect(r.daysOverdue).toBe(2);
    expect(r.armed).toBe(true);
  });

  it("parses quiet row with daysUntil", () => {
    const r = WatcherDeepRowSchema.parse({ ...BASE_DEEP_ROW, status: "quiet", daysOverdue: null, daysUntil: 5 });
    expect(r.daysUntil).toBe(5);
  });

  it("rejects unknown fields (strict) — score, recommendation", () => {
    expect(WatcherDeepRowSchema.safeParse({ ...BASE_DEEP_ROW, score: 99 }).success).toBe(false);
    expect(WatcherDeepRowSchema.safeParse({ ...BASE_DEEP_ROW, recommendation: "snooze" }).success).toBe(false);
  });

  it("rejects missing status", () => {
    const rest = { id: BASE_DEEP_ROW.id, category: BASE_DEEP_ROW.category, label: BASE_DEEP_ROW.label, kind: BASE_DEEP_ROW.kind, armed: BASE_DEEP_ROW.armed, threshold: BASE_DEEP_ROW.threshold, snoozedUntil: BASE_DEEP_ROW.snoozedUntil, daysOverdue: BASE_DEEP_ROW.daysOverdue, daysUntil: BASE_DEEP_ROW.daysUntil, message: BASE_DEEP_ROW.message, reasonCodes: BASE_DEEP_ROW.reasonCodes };
    expect(WatcherDeepRowSchema.safeParse(rest).success).toBe(false);
  });
});

describe("WatcherListResponseDataSchema", () => {
  it("parses list with one row", () => {
    const r = WatcherListResponseDataSchema.parse({ watchers: [BASE_DEEP_ROW] });
    expect(r.watchers).toHaveLength(1);
  });

  it("parses empty list", () => {
    expect(WatcherListResponseDataSchema.parse({ watchers: [] }).watchers).toHaveLength(0);
  });
});

describe("PatchWatcherArmedRequestSchema", () => {
  it("parses armed true and false", () => {
    expect(PatchWatcherArmedRequestSchema.parse({ armed: true }).armed).toBe(true);
    expect(PatchWatcherArmedRequestSchema.parse({ armed: false }).armed).toBe(false);
  });

  it("rejects non-boolean armed value", () => {
    expect(PatchWatcherArmedRequestSchema.safeParse({ armed: 1 }).success).toBe(false);
    expect(PatchWatcherArmedRequestSchema.safeParse({ armed: "yes" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(PatchWatcherArmedRequestSchema.safeParse({ armed: true, score: 1 }).success).toBe(false);
  });
});

describe("CreateReversePlanWatcherRequestSchema — strict + overflow refine", () => {
  const VALID_RP = {
    label: "여권 갱신",
    targetDate: "2026-07-30",
    safetyDays: 3,
    steps: [{ label: "여권 신청", leadDays: 21 }]
  };

  it("parses valid input", () => {
    expect(CreateReversePlanWatcherRequestSchema.safeParse(VALID_RP).success).toBe(true);
  });

  it("rejects injected unknown fields (strict)", () => {
    expect(CreateReversePlanWatcherRequestSchema.safeParse({ ...VALID_RP, score: 0.9 }).success).toBe(false);
    expect(CreateReversePlanWatcherRequestSchema.safeParse({ ...VALID_RP, recommendation: "act" }).success).toBe(false);
    expect(CreateReversePlanWatcherRequestSchema.safeParse({ ...VALID_RP, certainty: 1 }).success).toBe(false);
  });

  it("rejects injected fields on step (strict)", () => {
    const withExtra = { ...VALID_RP, steps: [{ label: "A", leadDays: 5, extra: true }] };
    expect(CreateReversePlanWatcherRequestSchema.safeParse(withExtra).success).toBe(false);
  });

  it("rejects overflow targetDate (2026-02-30)", () => {
    expect(CreateReversePlanWatcherRequestSchema.safeParse({ ...VALID_RP, targetDate: "2026-02-30" }).success).toBe(false);
  });

  it("rejects overflow targetDate (2026-04-31)", () => {
    expect(CreateReversePlanWatcherRequestSchema.safeParse({ ...VALID_RP, targetDate: "2026-04-31" }).success).toBe(false);
  });

  it("accepts valid calendar date (2026-02-28)", () => {
    expect(CreateReversePlanWatcherRequestSchema.safeParse({ ...VALID_RP, targetDate: "2026-02-28" }).success).toBe(true);
  });
});

describe("WatchersQuerySchema", () => {
  it("parses valid date and now with offset", () => {
    const r = WatchersQuerySchema.parse({ date: "2026-06-22", now: "2026-06-22T09:00:00+09:00" });
    expect(r.date).toBe("2026-06-22");
  });

  it("rejects missing date", () => {
    expect(WatchersQuerySchema.safeParse({ now: "2026-06-22T09:00:00+09:00" }).success).toBe(false);
  });

  it("rejects now without timezone designator", () => {
    expect(WatchersQuerySchema.safeParse({ date: "2026-06-22", now: "2026-06-22T09:00:00" }).success).toBe(false);
  });
});
