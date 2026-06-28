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

// Provider-neutral travel-time evidence for an adjacent event pair (cycle-76).
// Additive evidence only — it never mutates schedules or replaces the
// deterministic thread-based transition cost. `fresh` = usable cached/provider
// duration within freshness policy; `stale` = cached duration past the window
// (context only, never a hard requirement); `unavailable` = disabled/failed/
// timeout/rate-limit/no-route; `missing_geocode` = an endpoint lacks resolved
// coordinates; `same_location` = endpoints coincide so travel is not meaningful.
// No raw provider payload/URL/key/error is ever carried here.
export const TRAVEL_EVIDENCE_STATUSES = ["fresh", "stale", "unavailable", "missing_geocode", "same_location"] as const;
export const TravelEvidenceStatusSchema = z.enum(TRAVEL_EVIDENCE_STATUSES);

// Provenance of the travel evidence (cycle-78). Optional + back-compatible:
// existing provider/cache evidence omits it; a user-pinned fact sets
// `pinned_user` so the UI/gap math can label and explain manual facts.
export const TRAVEL_EVIDENCE_SOURCES = ["provider", "pinned_user"] as const;
export const TravelEvidenceSourceSchema = z.enum(TRAVEL_EVIDENCE_SOURCES);

export const TransitionTravelSchema = z
  .object({
    status: TravelEvidenceStatusSchema,
    durationMinutes: z.number().nullable(),
    distanceMeters: z.number().nullable(),
    provider: z.string().nullable(),
    providerStatus: z.string().nullable(),
    mode: z.string().nullable(),
    ageMinutes: z.number().nullable(),
    reasonCodes: z.array(z.string()),
    source: TravelEvidenceSourceSchema.optional(),
    // Optional user-authored manual transit detail (cycle-80), meaningful only for
    // a `pinned_user` fact (e.g. "9호선 1정거장"). Explanatory context only — it
    // never affects gap math. Back-compatible + `.strict` still rejects route-step
    // / fare / provider raw fields.
    note: z.string().max(200).nullable().optional()
  })
  .strict();

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
    reasonCodes: z.array(z.string()),
    // Optional travel evidence (cycle-76). Absent on existing payloads.
    travel: TransitionTravelSchema.optional()
  })
  .strict();

// Sequence-aware energy (FR-FEAS-09): duration-only work load plus deterministic
// context-switch load, reported separately so `energy` stays duration-only.
export const SequenceEnergySchema = z
  .object({
    workLoadUnits: z.number(),
    transitionLoadUnits: z.number(),
    totalLoadUnits: z.number(),
    budgetUnits: z.number(),
    remainingUnits: z.number(),
    deficit: z.boolean(),
    unknownTransitionCount: z.number().int().nonnegative(),
    confidence: z.enum(["cold_start"]),
    reasonCodes: z.array(z.string())
  })
  .strict();

// Sequence Ordering Diagnostics (FR-FEAS-10 A-slice). Read-only evidence about
// the day's scheduled event order: hard dependency edges, current-order
// violations, a deterministic topological candidate order, parallel groups, and
// critical path. Explanatory only — never an instruction or auto-reschedule.
export const SequenceOrderDependencyKindSchema = z.enum(["requires", "blocks"]);
export const SequenceOrderFirmnessSchema = z.enum(["hard", "soft", "tentative"]);

// A normalized "must come before" directed edge: `from` must precede `to`.
export const SequenceOrderEdgeSchema = z
  .object({
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    kind: SequenceOrderDependencyKindSchema,
    firmness: SequenceOrderFirmnessSchema
  })
  .strict();

export const SequenceOrderViolationSchema = z
  .object({
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    kind: SequenceOrderDependencyKindSchema
  })
  .strict();

export const SequenceOrderGroupSchema = z
  .object({
    eventIds: z.array(z.number().int().positive())
  })
  .strict();

export const SequenceOrderSchema = z
  .object({
    scope: z.literal("day_scheduled_events"),
    currentOrder: z.array(z.number().int().positive()),
    candidateOrder: z.array(z.number().int().positive()),
    orderChanged: z.boolean(),
    hardEdges: z.array(SequenceOrderEdgeSchema),
    softEdges: z.array(SequenceOrderEdgeSchema),
    violations: z.array(SequenceOrderViolationSchema),
    parallelGroups: z.array(SequenceOrderGroupSchema),
    criticalPath: z.array(z.number().int().positive()),
    cycleDetected: z.boolean(),
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
  transitionCosts: z.array(TransitionCostSchema),
  sequenceEnergy: SequenceEnergySchema,
  sequenceOrder: SequenceOrderSchema
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
export type TravelEvidenceStatus = z.infer<typeof TravelEvidenceStatusSchema>;
export type TravelEvidenceSource = z.infer<typeof TravelEvidenceSourceSchema>;
export type TransitionTravel = z.infer<typeof TransitionTravelSchema>;
export type TransitionCost = z.infer<typeof TransitionCostSchema>;
export type SequenceEnergy = z.infer<typeof SequenceEnergySchema>;
export type SequenceOrderDependencyKind = z.infer<typeof SequenceOrderDependencyKindSchema>;
export type SequenceOrderFirmness = z.infer<typeof SequenceOrderFirmnessSchema>;
export type SequenceOrderEdge = z.infer<typeof SequenceOrderEdgeSchema>;
export type SequenceOrderViolation = z.infer<typeof SequenceOrderViolationSchema>;
export type SequenceOrderGroup = z.infer<typeof SequenceOrderGroupSchema>;
export type SequenceOrder = z.infer<typeof SequenceOrderSchema>;
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
