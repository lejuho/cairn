import { z } from "zod";
import { createApiSuccessSchema } from "./api.js";

export const MIRROR_OUTCOMES = ["moved", "cancelled"] as const;
export const MirrorOutcomeSchema = z.enum(MIRROR_OUTCOMES);

export const EFFORT_BUCKETS = ["none", "low", "medium", "high", "unknown"] as const;
export const EffortBucketSchema = z.enum(EFFORT_BUCKETS);

export const MIRROR_SAMPLE_STATUSES = ["ok", "low_sample"] as const;
export const MirrorSampleStatusSchema = z.enum(MIRROR_SAMPLE_STATUSES);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MirrorLedgerQuerySchema = z
  .object({
    from: z.string().regex(DATE_RE, "from must be YYYY-MM-DD").optional(),
    to: z.string().regex(DATE_RE, "to must be YYYY-MM-DD").optional()
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

export type MirrorOutcome = z.infer<typeof MirrorOutcomeSchema>;
export type EffortBucket = z.infer<typeof EffortBucketSchema>;
export type MirrorSampleStatus = z.infer<typeof MirrorSampleStatusSchema>;
export type MirrorLedgerQuery = z.infer<typeof MirrorLedgerQuerySchema>;
export type MirrorLedgerCost = z.infer<typeof MirrorLedgerCostSchema>;
export type MirrorLedgerEntry = z.infer<typeof MirrorLedgerEntrySchema>;
export type MirrorLedgerSummary = z.infer<typeof MirrorLedgerSummarySchema>;
export type MirrorLedgerData = z.infer<typeof MirrorLedgerDataSchema>;
