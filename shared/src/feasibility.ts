import { z } from "zod";

export const FeasibilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true })
});

export const FeasibilityParamsSchema = z.object({
  energyBudget: z.number(),
  meetBufferMinutes: z.number(),
  deepBufferMinutes: z.number(),
  travelMargin: z.number(),
  maxContinuousMinutes: z.number()
});

export const EnergySchema = z.object({
  loadUnits: z.number(),
  budgetUnits: z.number(),
  remainingUnits: z.number(),
  deficit: z.boolean(),
  confidence: z.enum(["cold_start"])
});

export const GapStatusSchema = z.enum(["ok", "tight", "impossible"]);
export const GapModeSchema = z.enum(["planning", "near"]);

export const GapSchema = z.object({
  availableMinutes: z.number(),
  requiredMinutes: z.number(),
  status: GapStatusSchema,
  mode: GapModeSchema,
  reasonCodes: z.array(z.string())
});

export const ContinuousSchema = z.object({
  spanMinutes: z.number(),
  exceedsMax: z.boolean()
});

export const TransitionRelationSchema = z.enum([
  "same_thread",
  "context_link",
  "non_context_link",
  "unrelated",
  "missing_thread"
]);
export const TransitionCostLevelSchema = z.enum(["none", "low", "high", "unknown"]);
export const TransitionRelationKindSchema = z.enum([
  "contains",
  "blocks",
  "feeds",
  "competes",
  "shares"
]);
export const TransitionFirmnessSchema = z.enum(["hard", "soft"]);

export const TransitionCostSchema = z
  .object({
    fromEventId: z.number().int().positive(),
    toEventId: z.number().int().positive(),
    fromThreadId: z.number().int().positive().nullable(),
    toThreadId: z.number().int().positive().nullable(),
    relation: TransitionRelationSchema,
    relationKind: TransitionRelationKindSchema.optional(),
    firmness: TransitionFirmnessSchema.optional(),
    costLevel: TransitionCostLevelSchema,
    reasonCodes: z.array(z.string())
  })
  .strict();

export const DayFeasibilitySchema = z.object({
  date: z.string(),
  now: z.string(),
  params: FeasibilityParamsSchema,
  energy: EnergySchema,
  gaps: z.array(GapSchema),
  continuous: ContinuousSchema.nullable(),
  transitionCosts: z.array(TransitionCostSchema)
});

export type FeasibilityQuery = z.infer<typeof FeasibilityQuerySchema>;
export type FeasibilityParams = z.infer<typeof FeasibilityParamsSchema>;
export type Energy = z.infer<typeof EnergySchema>;
export type GapStatus = z.infer<typeof GapStatusSchema>;
export type GapMode = z.infer<typeof GapModeSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type Continuous = z.infer<typeof ContinuousSchema>;
export type TransitionRelation = z.infer<typeof TransitionRelationSchema>;
export type TransitionCostLevel = z.infer<typeof TransitionCostLevelSchema>;
export type TransitionRelationKind = z.infer<typeof TransitionRelationKindSchema>;
export type TransitionFirmness = z.infer<typeof TransitionFirmnessSchema>;
export type TransitionCost = z.infer<typeof TransitionCostSchema>;
export type DayFeasibility = z.infer<typeof DayFeasibilitySchema>;

// Full replacement body — all five keys required, ranges enforced.
export const UpdateFeasibilityParamsRequestSchema = z.object({
  energyBudget: z.number().finite().min(1).max(16),
  meetBufferMinutes: z.number().finite().int().min(0).max(120),
  deepBufferMinutes: z.number().finite().int().min(0).max(180),
  travelMargin: z.number().finite().min(0.5).max(3),
  maxContinuousMinutes: z.number().finite().int().min(60).max(960)
}).strict();

export const FeasibilityParamLimitSchema = z.object({
  min: z.number(),
  max: z.number(),
  step: z.number(),
  unit: z.string()
}).strict();

export const FeasibilityParamLimitsSchema = z.object({
  energyBudget: FeasibilityParamLimitSchema,
  meetBufferMinutes: FeasibilityParamLimitSchema,
  deepBufferMinutes: FeasibilityParamLimitSchema,
  travelMargin: FeasibilityParamLimitSchema,
  maxContinuousMinutes: FeasibilityParamLimitSchema
}).strict();

export const FeasibilityParamSettingsDataSchema = z.object({
  params: FeasibilityParamsSchema,
  defaults: FeasibilityParamsSchema,
  limits: FeasibilityParamLimitsSchema
}).strict();

export const PreviewFeasibilityRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true }),
  params: UpdateFeasibilityParamsRequestSchema
}).strict();

export type UpdateFeasibilityParamsRequest = z.infer<typeof UpdateFeasibilityParamsRequestSchema>;
export type FeasibilityParamLimit = z.infer<typeof FeasibilityParamLimitSchema>;
export type FeasibilityParamLimits = z.infer<typeof FeasibilityParamLimitsSchema>;
export type FeasibilityParamSettingsData = z.infer<typeof FeasibilityParamSettingsDataSchema>;
export type PreviewFeasibilityRequest = z.infer<typeof PreviewFeasibilityRequestSchema>;
