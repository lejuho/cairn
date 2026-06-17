import { z } from "zod";
import { EventSourceSchema, EventStatusSchema } from "./enums.js";

export const CreateEventRequestSchema = z.object({
  title: z.string().min(1),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  type: z.string().optional(),
  location: z.string().optional(),
  threadId: z.number().int().positive().optional(),
  personIds: z.array(z.number().int().positive()).optional()
});

export const EventRowSchema = z.object({
  id: z.number(),
  threadId: z.number().nullable(),
  title: z.string(),
  type: z.string().nullable(),
  start: z.string().datetime({ offset: true }).nullable(),
  end: z.string().datetime({ offset: true }).nullable(),
  location: z.string().nullable(),
  source: EventSourceSchema.nullable(),
  selfImposed: z.number().nullable(),
  status: EventStatusSchema.nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable()
});

export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;
export type EventRow = z.infer<typeof EventRowSchema>;
