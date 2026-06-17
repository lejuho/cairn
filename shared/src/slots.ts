import { z } from "zod";
import { EventRowSchema } from "./events.js";

export const SlotCandidateSchema = z.object({
  start: z.string(),
  end: z.string(),
  reasons: z.array(z.string()),
  reasonCodes: z.array(z.string())
});

export const SlotCandidatesQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true }),
  days: z.coerce.number().int().min(1).max(14).default(7)
});

export const SlotCandidatesResponseDataSchema = z.object({
  event: EventRowSchema,
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
