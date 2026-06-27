import { z } from "zod";
import { EventRowSchema } from "./events.js";
import { TaskRowSchema } from "./tasks.js";

export const SlotSuggestionLensSchema = z.enum(["availability", "feasibility", "people", "friction"]);
export type SlotSuggestionLens = z.infer<typeof SlotSuggestionLensSchema>;

export const SlotSuggestionImpactSchema = z.enum(["positive", "neutral", "negative"]);
export type SlotSuggestionImpact = z.infer<typeof SlotSuggestionImpactSchema>;

export const SlotSuggestionConfidenceSchema = z.enum(["observed", "cold_start", "unavailable"]);
export type SlotSuggestionConfidence = z.infer<typeof SlotSuggestionConfidenceSchema>;

export const SlotSuggestionContributionSchema = z.object({
  lens: SlotSuggestionLensSchema,
  label: z.string(),
  impact: SlotSuggestionImpactSchema,
  points: z.number(),
  confidence: SlotSuggestionConfidenceSchema,
  reasonCodes: z.array(z.string()),
  evidence: z.array(z.string()),
  personIds: z.array(z.number()).optional()
}).strict();
export type SlotSuggestionContribution = z.infer<typeof SlotSuggestionContributionSchema>;

export const SlotCandidateSchema = z.object({
  start: z.string(),
  end: z.string(),
  score: z.number().int().min(0),
  rank: z.number().int().min(1),
  scoreLabel: z.string(),
  reasons: z.array(z.string()),
  reasonCodes: z.array(z.string()),
  contributions: z.array(SlotSuggestionContributionSchema)
}).strict();

export const SlotCandidatesQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true }),
  days: z.coerce.number().int().min(1).max(14).default(7)
});

export const SlotCandidatesResponseDataSchema = z.object({
  event: EventRowSchema,
  candidates: z.array(SlotCandidateSchema)
});

// Read-only task slot preview response (cycle-62 FR-SLOT-06C). Reuses the
// strict SlotCandidate shape; the candidates are preview evidence only and
// carry no schedulable event row.
export const TaskSlotCandidatesResponseDataSchema = z.object({
  task: TaskRowSchema,
  candidates: z.array(SlotCandidateSchema)
});

export const ScheduleEventRequestSchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true })
}).refine((v) => Date.parse(v.end) > Date.parse(v.start), { message: "end must be after start" });

export const ScheduleEventResponseDataSchema = z.object({
  event: EventRowSchema
});

export type SlotCandidate = z.infer<typeof SlotCandidateSchema>;
export type SlotCandidatesQuery = z.infer<typeof SlotCandidatesQuerySchema>;
export type ScheduleEventRequest = z.infer<typeof ScheduleEventRequestSchema>;
export type TaskSlotCandidatesResponseData = z.infer<typeof TaskSlotCandidatesResponseDataSchema>;
