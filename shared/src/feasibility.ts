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

export const DayFeasibilitySchema = z.object({
  date: z.string(),
  now: z.string(),
  params: FeasibilityParamsSchema,
  energy: EnergySchema,
  gaps: z.array(GapSchema),
  continuous: ContinuousSchema.nullable()
});

export type FeasibilityQuery = z.infer<typeof FeasibilityQuerySchema>;
export type FeasibilityParams = z.infer<typeof FeasibilityParamsSchema>;
export type Energy = z.infer<typeof EnergySchema>;
export type GapStatus = z.infer<typeof GapStatusSchema>;
export type GapMode = z.infer<typeof GapModeSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type Continuous = z.infer<typeof ContinuousSchema>;
export type DayFeasibility = z.infer<typeof DayFeasibilitySchema>;
