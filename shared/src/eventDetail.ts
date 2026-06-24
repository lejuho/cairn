import { z } from "zod";
import { EventModeSchema, EventRowSchema } from "./events.js";
import { EventStatusSchema } from "./enums.js";
import { PersonRowSchema, PreferredPeriodSchema, WeekdaySchema } from "./people.js";
import { AnnotationRowSchema } from "./annotations.js";

export const CompactThreadSchema = z.object({
  id: z.number(),
  name: z.string()
});

// Schedule Brief A (cairn-spec section 11, FR-BRF). Read-only highlight layer
// assembled from data Cairn already owns. No LLM, no external/movement data.
export const ScheduleBriefThreadSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    goal: z.string().nullable(),
    deadline: z.string().nullable()
  })
  .strict();

export const ScheduleBriefPreviousEventSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    start: z.string().nullable(),
    end: z.string().nullable()
  })
  .strict();

// Factual authored profile fields only (no inferred sensitivities or advice).
export const ScheduleBriefPersonSchema = z
  .object({
    personId: z.number(),
    name: z.string(),
    relation: z.string().nullable(),
    preferredWeekdays: z.array(WeekdaySchema),
    preferredPeriods: z.array(PreferredPeriodSchema),
    leadTimeDays: z.number().int().nonnegative().nullable(),
    unavailableWeekdays: z.array(WeekdaySchema)
  })
  .strict();

export const ScheduleBriefSchema = z
  .object({
    mode: EventModeSchema.nullable(),
    thread: ScheduleBriefThreadSchema.nullable(),
    previousEvent: ScheduleBriefPreviousEventSchema.nullable(),
    previousAnnotation: AnnotationRowSchema.nullable(),
    people: z.array(ScheduleBriefPersonSchema),
    reasonCodes: z.array(z.string())
  })
  .strict();

export const EventDetailDataSchema = z.object({
  event: EventRowSchema,
  people: z.array(PersonRowSchema),
  annotations: z.array(AnnotationRowSchema),
  thread: CompactThreadSchema.nullable(),
  scheduleBrief: ScheduleBriefSchema
});

export const PatchEventStatusRequestSchema = z.object({
  status: EventStatusSchema
});

export const PatchEventStatusResponseDataSchema = z.object({
  event: EventRowSchema
});

export type CompactThread = z.infer<typeof CompactThreadSchema>;
export type ScheduleBriefThread = z.infer<typeof ScheduleBriefThreadSchema>;
export type ScheduleBriefPreviousEvent = z.infer<typeof ScheduleBriefPreviousEventSchema>;
export type ScheduleBriefPerson = z.infer<typeof ScheduleBriefPersonSchema>;
export type ScheduleBrief = z.infer<typeof ScheduleBriefSchema>;
export type EventDetailData = z.infer<typeof EventDetailDataSchema>;
export type PatchEventStatusRequest = z.infer<typeof PatchEventStatusRequestSchema>;
