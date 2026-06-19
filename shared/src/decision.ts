import { z } from "zod";
import { AnnotationRowSchema } from "./annotations.js";
import { EventRowSchema } from "./events.js";

export const ConflictDecisionQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true })
});

export const ConflictCostSchema = z.object({
  money: z.number().nullable(),
  social: z.number().nullable(),
  effort: z.string().nullable(),
  window: z.string().nullable()
});

export const ConflictDecisionOptionSchema = z.object({
  event: EventRowSchema,
  action: z.literal("move_or_cancel"),
  cost: ConflictCostSchema,
  reversible: z.number().nullable(),
  commitment: z.number().nullable(),
  suggested: z.boolean(),
  reasonCodes: z.array(z.string())
});

export const ConflictDecisionSchema = z.object({
  id: z.string(),
  pair: z.object({ a: EventRowSchema, b: EventRowSchema }),
  overlapMinutes: z.number(),
  urgency: z.enum(["near", "planning"]),
  actionability: z.enum(["resolvable", "read_only"]),
  disabledReasonCodes: z.array(z.string()),
  options: z.tuple([ConflictDecisionOptionSchema, ConflictDecisionOptionSchema])
});

export const ConflictDecisionsResponseDataSchema = z.object({
  conflicts: z.array(ConflictDecisionSchema)
});

export const ResolveConflictRequestSchema = z.object({
  keepEventId: z.number().int().positive(),
  changeEventId: z.number().int().positive(),
  outcome: z.enum(["moved", "cancelled"]),
  note: z.string().trim().min(1).optional(),
  now: z.string().datetime({ offset: true }).optional()
}).refine((v) => v.keepEventId !== v.changeEventId, {
  message: "keepEventId and changeEventId must be different events",
  path: ["changeEventId"]
});

export const ResolveConflictResponseDataSchema = z.object({
  changedEvent: EventRowSchema,
  annotation: AnnotationRowSchema
});

export type ConflictCost = z.infer<typeof ConflictCostSchema>;
export type ConflictDecisionOption = z.infer<typeof ConflictDecisionOptionSchema>;
export type ConflictDecision = z.infer<typeof ConflictDecisionSchema>;
export type ResolveConflictRequest = z.infer<typeof ResolveConflictRequestSchema>;
