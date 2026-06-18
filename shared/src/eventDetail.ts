import { z } from "zod";
import { EventRowSchema } from "./events.js";
import { EventStatusSchema } from "./enums.js";
import { PersonRowSchema } from "./people.js";
import { AnnotationRowSchema } from "./annotations.js";

export const CompactThreadSchema = z.object({
  id: z.number(),
  name: z.string()
});

export const EventDetailDataSchema = z.object({
  event: EventRowSchema,
  people: z.array(PersonRowSchema),
  annotations: z.array(AnnotationRowSchema),
  thread: CompactThreadSchema.nullable()
});

export const PatchEventStatusRequestSchema = z.object({
  status: EventStatusSchema
});

export const PatchEventStatusResponseDataSchema = z.object({
  event: EventRowSchema
});

export type CompactThread = z.infer<typeof CompactThreadSchema>;
export type EventDetailData = z.infer<typeof EventDetailDataSchema>;
export type PatchEventStatusRequest = z.infer<typeof PatchEventStatusRequestSchema>;
