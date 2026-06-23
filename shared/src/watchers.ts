import { z } from "zod";
import { WatcherKindSchema } from "./enums.js";

export const WatcherReasonCodeSchema = z.enum(["date_threshold_due"]);

export const WatcherABubbleSchema = z.object({
  id: z.number(),
  label: z.string().nullable(),
  category: z.string().nullable(),
  kind: z.literal("A"),
  threshold: z.string(),
  snoozedUntil: z.string().nullable(),
  daysOverdue: z.number().int().nonnegative(),
  reasonCodes: z.array(WatcherReasonCodeSchema),
  message: z.string()
}).strict();

export const CreateWatcherRequestSchema = z.object({
  label: z.string().min(1),
  threshold: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  category: z.string().optional()
});

export const PatchWatcherSnoozeRequestSchema = z.object({
  snoozedUntil: z.string().datetime({ offset: true })
});

export const PatchWatcherArmedRequestSchema = z.object({
  armed: z.boolean()
}).strict();

export const WatchersQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true })
});

export const WatcherDeepStatusSchema = z.enum(["due", "quiet", "snoozed", "disarmed", "unsupported"]);

// ---- Reverse-plan schemas ----

const YYYYMMDD_STRICT = /^\d{4}-\d{2}-\d{2}$/;

export const ReversePlanStepInputSchema = z.object({
  label: z.string().min(1),
  leadDays: z.number().int().min(0).max(365)
});

export const CreateReversePlanWatcherRequestSchema = z.object({
  label: z.string().min(1),
  category: z.string().optional(),
  targetDate: z.string().regex(YYYYMMDD_STRICT, "Must be YYYY-MM-DD"),
  targetLabel: z.string().min(1).optional(),
  safetyDays: z.number().int().min(0).max(30).default(0),
  steps: z.array(ReversePlanStepInputSchema).min(1).max(8)
});

export const ReversePlanStepDataSchema = z.object({
  label: z.string(),
  leadDays: z.number().int().nonnegative(),
  latestDate: z.string(),
  taskId: z.number().int()
});

export const ReversePlanDataSchema = z.object({
  type: z.literal("reverse_plan"),
  targetDate: z.string(),
  targetLabel: z.string(),
  safetyDays: z.number().int().nonnegative(),
  steps: z.array(ReversePlanStepDataSchema),
  targetTaskId: z.number().int()
});

// Subset of ReversePlanDataSchema used in WatcherDeepRow for UI rendering.
export const ReversePlanViewSchema = z.object({
  targetDate: z.string(),
  targetLabel: z.string(),
  safetyDays: z.number().int().nonnegative(),
  steps: z.array(z.object({
    label: z.string(),
    leadDays: z.number().int().nonnegative(),
    latestDate: z.string(),
    taskId: z.number().int(),
    taskStatus: z.string()
  })),
  nextStepIndex: z.number().int().nullable(),
  completed: z.boolean()
});

// ---- WatcherDeepRow ----

export const WatcherDeepRowSchema = z.object({
  id: z.number(),
  category: z.string().nullable(),
  label: z.string().nullable(),
  kind: z.string().nullable(),
  armed: z.boolean(),
  threshold: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  status: WatcherDeepStatusSchema,
  daysOverdue: z.number().int().nonnegative().nullable(),
  daysUntil: z.number().int().nonnegative().nullable(),
  message: z.string(),
  reasonCodes: z.array(z.string()),
  reversePlan: ReversePlanViewSchema.nullable().optional()
}).strict();

export const WatcherListResponseDataSchema = z.object({
  watchers: z.array(WatcherDeepRowSchema)
});

export const WatcherRowSchema = z.object({
  id: z.number(),
  category: z.string().nullable(),
  label: z.string().nullable(),
  kind: WatcherKindSchema.nullable(),
  armed: z.number().nullable(),
  rule: z.string().nullable(),
  threshold: z.string().nullable(),
  lastFired: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  createdAt: z.string().nullable()
});

export type WatcherReasonCode = z.infer<typeof WatcherReasonCodeSchema>;
export type WatcherABubble = z.infer<typeof WatcherABubbleSchema>;
export type CreateWatcherRequest = z.infer<typeof CreateWatcherRequestSchema>;
export type ReversePlanStepInput = z.infer<typeof ReversePlanStepInputSchema>;
export type CreateReversePlanWatcherRequest = z.infer<typeof CreateReversePlanWatcherRequestSchema>;
export type ReversePlanStepData = z.infer<typeof ReversePlanStepDataSchema>;
export type ReversePlanData = z.infer<typeof ReversePlanDataSchema>;
export type ReversePlanView = z.infer<typeof ReversePlanViewSchema>;
export type PatchWatcherSnoozeRequest = z.infer<typeof PatchWatcherSnoozeRequestSchema>;
export type PatchWatcherArmedRequest = z.infer<typeof PatchWatcherArmedRequestSchema>;
export type WatchersQuery = z.infer<typeof WatchersQuerySchema>;
export type WatcherDeepStatus = z.infer<typeof WatcherDeepStatusSchema>;
export type WatcherDeepRow = z.infer<typeof WatcherDeepRowSchema>;
export type WatcherRow = z.infer<typeof WatcherRowSchema>;
