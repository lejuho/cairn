import { z } from "zod";
import { EventModeSchema, EventRowSchema } from "./events.js";
import { EventStatusSchema } from "./enums.js";
import { PersonRowSchema, PreferredPeriodSchema, WeekdaySchema } from "./people.js";
import { AnnotationRowSchema } from "./annotations.js";
import { ResourceFirmnessSchema, ResourceRowSchema } from "./resources.js";

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

// Preparation Brief A (cycle-45 FR-BRF-04). Read-only list of already-known
// resources linked to the event, its thread, or the nearest prior same-thread
// event. Automatic highlight only — no AI suggestion, manual entry, or
// procurement/movement fields.
export const ScheduleBriefPreparationScopeSchema = z.enum([
  "event_direct",
  "thread_context",
  "previous_event"
]);

export const ScheduleBriefPreparationLinkSchema = z
  .object({
    targetType: z.enum(["event", "thread"]),
    targetId: z.number().int().positive(),
    scope: ScheduleBriefPreparationScopeSchema,
    firmness: ResourceFirmnessSchema,
    reason: z.string().nullable()
  })
  .strict();

export const ScheduleBriefPreparationSchema = z
  .object({
    resource: ResourceRowSchema,
    sourcePerson: z.object({ id: z.number(), name: z.string() }).nullable(),
    links: z.array(ScheduleBriefPreparationLinkSchema),
    reasonCodes: z.array(z.string())
  })
  .strict();

export const ScheduleBriefSchema = z
  .object({
    mode: EventModeSchema.nullable(),
    thread: ScheduleBriefThreadSchema.nullable(),
    previousEvent: ScheduleBriefPreviousEventSchema.nullable(),
    previousAnnotation: AnnotationRowSchema.nullable(),
    people: z.array(ScheduleBriefPersonSchema),
    preparations: z.array(ScheduleBriefPreparationSchema),
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
export type ScheduleBriefPreparationScope = z.infer<typeof ScheduleBriefPreparationScopeSchema>;
export type ScheduleBriefPreparationLink = z.infer<typeof ScheduleBriefPreparationLinkSchema>;
export type ScheduleBriefPreparation = z.infer<typeof ScheduleBriefPreparationSchema>;
export type ScheduleBrief = z.infer<typeof ScheduleBriefSchema>;
export type EventDetailData = z.infer<typeof EventDetailDataSchema>;
export type PatchEventStatusRequest = z.infer<typeof PatchEventStatusRequestSchema>;
