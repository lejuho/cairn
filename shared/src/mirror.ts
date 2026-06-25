import { z } from "zod";
import { createApiSuccessSchema } from "./api.js";

export const MIRROR_OUTCOMES = ["moved", "cancelled"] as const;
export const MirrorOutcomeSchema = z.enum(MIRROR_OUTCOMES);

export const EFFORT_BUCKETS = ["none", "low", "medium", "high", "unknown"] as const;
export const EffortBucketSchema = z.enum(EFFORT_BUCKETS);

export const MIRROR_SAMPLE_STATUSES = ["ok", "low_sample"] as const;
export const MirrorSampleStatusSchema = z.enum(MIRROR_SAMPLE_STATUSES);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Regex only checks shape; values like 2026-99-99 or 2026-02-30 still pass it.
// Date.parse rejects 2026-99-99 (NaN) but silently rolls 2026-02-30 over to
// 2026-03-02, so a round-trip check is required to reject overflow dates.
export function isCalendarDate(value: string): boolean {
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    return false;
  }
  return new Date(ms).toISOString().startsWith(value);
}

const IsoCalendarDateSchema = z
  .string()
  .regex(DATE_RE, "must be YYYY-MM-DD")
  .refine(isCalendarDate, "must be a real calendar date");

export const MirrorLedgerQuerySchema = z
  .object({
    from: IsoCalendarDateSchema.optional(),
    to: IsoCalendarDateSchema.optional()
  })
  .refine((q) => q.from == null || q.to == null || q.from <= q.to, {
    message: "from must be <= to",
    path: ["from"]
  });

// Cost dimensions stay split — no scalar score. .strict() rejects an injected
// total/score field, which the Sprint Contract requires shared tests to prove.
export const MirrorLedgerCostSchema = z
  .object({
    money: z.number(),
    social: z.number(),
    effort: EffortBucketSchema,
    window: z.string().nullable(),
    hasAnyCost: z.boolean()
  })
  .strict();

export const MirrorLedgerThreadSchema = z.object({
  id: z.number(),
  name: z.string()
});

export const MirrorLedgerEntrySchema = z.object({
  annotationId: z.number(),
  eventId: z.number(),
  eventTitle: z.string(),
  thread: MirrorLedgerThreadSchema.nullable(),
  outcome: MirrorOutcomeSchema,
  reasonText: z.string().nullable(),
  reasonTags: z.array(z.string()),
  loggedAt: z.string(),
  eventStart: z.string().nullable(),
  cost: MirrorLedgerCostSchema
});

export const MirrorEffortBreakdownSchema = z.object({
  none: z.number(),
  low: z.number(),
  medium: z.number(),
  high: z.number(),
  unknown: z.number()
});

export const MirrorLedgerSummarySchema = z.object({
  totalChanges: z.number(),
  movedCount: z.number(),
  cancelledCount: z.number(),
  freeCount: z.number(),
  paidCount: z.number(),
  moneyTotal: z.number(),
  socialTotal: z.number(),
  effortBreakdown: MirrorEffortBreakdownSchema
});

export const MirrorLedgerRangeSchema = z.object({
  from: z.string(),
  to: z.string()
});

export const MirrorLedgerDataSchema = z.object({
  range: MirrorLedgerRangeSchema,
  summary: MirrorLedgerSummarySchema,
  entries: z.array(MirrorLedgerEntrySchema),
  sampleStatus: MirrorSampleStatusSchema
});

export const MirrorLedgerResponseSchema = createApiSuccessSchema(MirrorLedgerDataSchema);

// ── Pattern A schemas ─────────────────────────────────────────────────────────

// Reusable base: two optional date fields, no from<=to refine.
// Each consumer (ledger, patterns) adds its own from<=to refine so the contracts
// stay independent and can be tested in isolation.
export const MirrorRangeQuerySchema = z.object({
  from: IsoCalendarDateSchema.optional(),
  to: IsoCalendarDateSchema.optional()
});

export const MirrorPatternsQuerySchema = MirrorRangeQuerySchema.refine(
  (q) => q.from == null || q.to == null || q.from <= q.to,
  { message: "from must be <= to", path: ["from"] }
);

export const MirrorPatternOutcomeCountsSchema = z.object({
  done: z.number(),
  moved: z.number(),
  cancelled: z.number(),
  late: z.number()
});

export const MirrorPatternBucketSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    total: z.number(),
    outcomes: MirrorPatternOutcomeCountsSchema,
    slipCount: z.number(),
    slipRatio: z.number(),
    sampleStatus: MirrorSampleStatusSchema
  })
  .strict();

export const MirrorPatternThreadBucketSchema = z
  .object({
    key: z.string(),
    thread: z.object({ id: z.number(), name: z.string() }).nullable(),
    label: z.string(),
    total: z.number(),
    outcomes: MirrorPatternOutcomeCountsSchema,
    slipCount: z.number(),
    slipRatio: z.number(),
    sampleStatus: MirrorSampleStatusSchema
  })
  .strict();

export const MirrorPatternsTotalsSchema = z.object({
  annotations: z.number(),
  done: z.number(),
  moved: z.number(),
  cancelled: z.number(),
  late: z.number(),
  slipCount: z.number()
});

export const MirrorPatternsDataSchema = z.object({
  range: MirrorLedgerRangeSchema,
  totals: MirrorPatternsTotalsSchema,
  weekday: z.array(MirrorPatternBucketSchema),
  type: z.array(MirrorPatternBucketSchema),
  thread: z.array(MirrorPatternThreadBucketSchema),
  sampleStatus: MirrorSampleStatusSchema
});

export const MirrorPatternsResponseSchema = createApiSuccessSchema(MirrorPatternsDataSchema);

// ── Energy Trend A schemas ────────────────────────────────────────────────────

// 90-day max: diff = (to - from) in full days. Inclusive count = diff + 1 <= 90
// → diff <= 89. Applies only when both bounds are explicitly provided.
export const MirrorEnergyTrendQuerySchema = MirrorRangeQuerySchema.refine(
  (q) => q.from == null || q.to == null || q.from <= q.to,
  { message: "from must be <= to", path: ["from"] }
).refine(
  (q) => {
    if (q.from == null || q.to == null) return true;
    const fromMs = Date.parse(`${q.from}T00:00:00Z`);
    const toMs = Date.parse(`${q.to}T00:00:00Z`);
    return (toMs - fromMs) / 86_400_000 <= 89;
  },
  { message: "range must not exceed 90 days", path: ["from"] }
);

export const MirrorEnergyTrendDaySchema = z
  .object({
    date: z.string(),
    eventCount: z.number(),
    loadUnits: z.number(),
    budgetUnits: z.number(),
    remainingUnits: z.number(),
    deficit: z.boolean(),
    continuousExceeded: z.boolean()
  })
  .strict();

export const MirrorEnergyTrendSummarySchema = z
  .object({
    days: z.number(),
    scheduledDays: z.number(),
    deficitDays: z.number(),
    averageDailyLoadUnits: z.number(),
    averageScheduledLoadUnits: z.number(),
    peakLoadUnits: z.number(),
    budgetUnits: z.number(),
    sampleStatus: MirrorSampleStatusSchema
  })
  .strict();

export const MirrorEnergyTrendDataSchema = z.object({
  range: MirrorLedgerRangeSchema,
  summary: MirrorEnergyTrendSummarySchema,
  days: z.array(MirrorEnergyTrendDaySchema),
  sampleStatus: MirrorSampleStatusSchema
});

export const MirrorEnergyTrendResponseSchema = createApiSuccessSchema(MirrorEnergyTrendDataSchema);

export type MirrorOutcome = z.infer<typeof MirrorOutcomeSchema>;
export type EffortBucket = z.infer<typeof EffortBucketSchema>;
export type MirrorSampleStatus = z.infer<typeof MirrorSampleStatusSchema>;
export type MirrorLedgerQuery = z.infer<typeof MirrorLedgerQuerySchema>;
export type MirrorPatternsQuery = z.infer<typeof MirrorPatternsQuerySchema>;
export type MirrorLedgerCost = z.infer<typeof MirrorLedgerCostSchema>;
export type MirrorLedgerEntry = z.infer<typeof MirrorLedgerEntrySchema>;
export type MirrorLedgerSummary = z.infer<typeof MirrorLedgerSummarySchema>;
export type MirrorLedgerData = z.infer<typeof MirrorLedgerDataSchema>;
export type MirrorPatternBucket = z.infer<typeof MirrorPatternBucketSchema>;
export type MirrorPatternThreadBucket = z.infer<typeof MirrorPatternThreadBucketSchema>;
export type MirrorPatternsTotals = z.infer<typeof MirrorPatternsTotalsSchema>;
export type MirrorPatternsData = z.infer<typeof MirrorPatternsDataSchema>;
export type MirrorEnergyTrendQuery = z.infer<typeof MirrorEnergyTrendQuerySchema>;
export type MirrorEnergyTrendDay = z.infer<typeof MirrorEnergyTrendDaySchema>;
export type MirrorEnergyTrendSummary = z.infer<typeof MirrorEnergyTrendSummarySchema>;
export type MirrorEnergyTrendData = z.infer<typeof MirrorEnergyTrendDataSchema>;

// ── Automation-needs schemas ──────────────────────────────────────────────────

export const MirrorAutomationNeedsQuerySchema = MirrorRangeQuerySchema.refine(
  (q) => q.from == null || q.to == null || q.from <= q.to,
  { message: "from must be <= to", path: ["from"] }
).refine(
  (q) => {
    if (q.from == null || q.to == null) return true;
    const fromMs = Date.parse(`${q.from}T00:00:00Z`);
    const toMs = Date.parse(`${q.to}T00:00:00Z`);
    return (toMs - fromMs) / 86_400_000 <= 89;
  },
  { message: "range must not exceed 90 days", path: ["from"] }
);

export const AUTOMATION_NEED_LEVELS = ["quiet", "watch", "consider_lightweight"] as const;
export const AutomationNeedLevelSchema = z.enum(AUTOMATION_NEED_LEVELS);

export const MirrorAutomationNeedItemSchema = z.object({
  watcherId: z.number(),
  label: z.string().nullable(),
  category: z.string().nullable(),
  sourceStability: z.string(),
  manualLogCount: z.number().int().nonnegative(),
  signalSeenCount: z.number().int().nonnegative(),
  missedSignalCount: z.number().int().nonnegative(),
  missRate: z.number().min(0).max(1),
  level: AutomationNeedLevelSchema,
  reasonCodes: z.array(z.string()),
  reasons: z.array(z.string())
}).strict();

export const MirrorAutomationNeedsDataSchema = z.object({
  range: MirrorLedgerRangeSchema,
  items: z.array(MirrorAutomationNeedItemSchema),
  sampleStatus: MirrorSampleStatusSchema
});

export type MirrorAutomationNeedsQuery = z.infer<typeof MirrorAutomationNeedsQuerySchema>;
export type AutomationNeedLevel = z.infer<typeof AutomationNeedLevelSchema>;
export type MirrorAutomationNeedItem = z.infer<typeof MirrorAutomationNeedItemSchema>;
export type MirrorAutomationNeedsData = z.infer<typeof MirrorAutomationNeedsDataSchema>;

// ── Diary schemas ─────────────────────────────────────────────────────────────

export const MirrorDiaryQuerySchema = MirrorRangeQuerySchema.refine(
  (q) => q.from == null || q.to == null || q.from <= q.to,
  { message: "from must be <= to", path: ["from"] }
).refine(
  (q) => {
    if (q.from == null || q.to == null) return true;
    const fromMs = Date.parse(`${q.from}T00:00:00Z`);
    const toMs = Date.parse(`${q.to}T00:00:00Z`);
    return (toMs - fromMs) / 86_400_000 <= 89;
  },
  { message: "range must not exceed 90 days", path: ["from"] }
);

export const MIRROR_DIARY_DEPTHS = ["automatic", "semi_auto"] as const;
export const MirrorDiaryDepthSchema = z.enum(MIRROR_DIARY_DEPTHS);

export const MirrorDiaryEntrySchema = z
  .object({
    annotationId: z.number().int().positive(),
    eventId: z.number().int().positive(),
    eventTitle: z.string(),
    eventStart: z.string().nullable(),
    thread: z.object({ id: z.number(), name: z.string() }).nullable(),
    outcome: z.string(),
    reasonText: z.string().nullable(),
    reasonTags: z.array(z.string()),
    loggedAt: z.string(),
    depth: MirrorDiaryDepthSchema,
    contextLabel: z.string()
  })
  .strict();

export const MirrorDiaryDaySchema = z
  .object({
    date: z.string(),
    headline: z.string().nullable(),
    entries: z.array(MirrorDiaryEntrySchema)
  })
  .strict();

export const MirrorDiaryDataSchema = z.object({
  range: MirrorLedgerRangeSchema,
  days: z.array(MirrorDiaryDaySchema),
  sampleStatus: MirrorSampleStatusSchema
});

export const MirrorDiaryResponseSchema = z.object({
  ok: z.literal(true),
  data: MirrorDiaryDataSchema
});

export type MirrorDiaryQuery = z.infer<typeof MirrorDiaryQuerySchema>;
export type MirrorDiaryDepth = z.infer<typeof MirrorDiaryDepthSchema>;
export type MirrorDiaryEntry = z.infer<typeof MirrorDiaryEntrySchema>;
export type MirrorDiaryDay = z.infer<typeof MirrorDiaryDaySchema>;
export type MirrorDiaryData = z.infer<typeof MirrorDiaryDataSchema>;

// Mirror Transition Friction A (cycle-49 FR-MIR-09). Read-only retrospective
// evidence: per-day thread transition counts + nearby outcome/energy.
// Descriptive only — strict schemas reject any injected scalar/suggestion field.
export const MirrorTransitionFrictionQuerySchema = MirrorRangeQuerySchema.refine(
  (q) => q.from == null || q.to == null || q.from <= q.to,
  { message: "from must be <= to", path: ["from"] }
).refine(
  (q) => {
    if (q.from == null || q.to == null) return true;
    const fromMs = Date.parse(`${q.from}T00:00:00Z`);
    const toMs = Date.parse(`${q.to}T00:00:00Z`);
    return (toMs - fromMs) / 86_400_000 <= 89;
  },
  { message: "range must not exceed 90 days", path: ["from"] }
);

export const MirrorTransitionFrictionOutcomeCountsSchema = z
  .object({
    done: z.number().int().nonnegative(),
    moved: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    late: z.number().int().nonnegative()
  })
  .strict();

export const MirrorTransitionFrictionEnergySchema = z
  .object({
    entryCount: z.number().int().nonnegative(),
    averageEnergyAtTime: z.number().nullable()
  })
  .strict();

export const MirrorTransitionFrictionDaySchema = z
  .object({
    date: z.string(),
    eventCount: z.number().int().nonnegative(),
    transitionPairs: z.number().int().nonnegative(),
    sameThreadPairs: z.number().int().nonnegative(),
    contextPairs: z.number().int().nonnegative(),
    unrelatedPairs: z.number().int().nonnegative(),
    missingThreadPairs: z.number().int().nonnegative(),
    lowTransitionPairs: z.number().int().nonnegative(),
    highTransitionPairs: z.number().int().nonnegative(),
    unknownTransitionPairs: z.number().int().nonnegative(),
    outcomes: MirrorTransitionFrictionOutcomeCountsSchema,
    energy: MirrorTransitionFrictionEnergySchema,
    sampleStatus: MirrorSampleStatusSchema,
    reasonCodes: z.array(z.string())
  })
  .strict();

export const MirrorTransitionFrictionSummarySchema = z
  .object({
    days: z.number().int().nonnegative(),
    activeDays: z.number().int().nonnegative(),
    totalTransitionPairs: z.number().int().nonnegative(),
    lowTransitionPairs: z.number().int().nonnegative(),
    highTransitionPairs: z.number().int().nonnegative(),
    unknownTransitionPairs: z.number().int().nonnegative(),
    lowSampleDays: z.number().int().nonnegative(),
    sampleStatus: MirrorSampleStatusSchema
  })
  .strict();

export const MirrorTransitionFrictionDataSchema = z
  .object({
    range: MirrorLedgerRangeSchema,
    summary: MirrorTransitionFrictionSummarySchema,
    days: z.array(MirrorTransitionFrictionDaySchema)
  })
  .strict();

export const MirrorTransitionFrictionResponseSchema = z.object({
  ok: z.literal(true),
  data: MirrorTransitionFrictionDataSchema
});

export type MirrorTransitionFrictionQuery = z.infer<typeof MirrorTransitionFrictionQuerySchema>;
export type MirrorTransitionFrictionOutcomeCounts = z.infer<typeof MirrorTransitionFrictionOutcomeCountsSchema>;
export type MirrorTransitionFrictionEnergy = z.infer<typeof MirrorTransitionFrictionEnergySchema>;
export type MirrorTransitionFrictionDay = z.infer<typeof MirrorTransitionFrictionDaySchema>;
export type MirrorTransitionFrictionSummary = z.infer<typeof MirrorTransitionFrictionSummarySchema>;
export type MirrorTransitionFrictionData = z.infer<typeof MirrorTransitionFrictionDataSchema>;
