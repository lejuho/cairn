import { z } from "zod";
import { EventSourceSchema, EventStatusSchema } from "./enums.js";

// Schedule Brief A (cairn-spec section 11, FR-BRF). Optional event mode.
// null = unknown (NOT remote/async). GCal/imported events stay null.
export const EventModeSchema = z.enum(["in_person", "remote", "async"]);

export const CreateEventRequestSchema = z.object({
  title: z.string().min(1),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  type: z.string().optional(),
  location: z.string().optional(),
  mode: EventModeSchema.optional(),
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
  mode: EventModeSchema.nullable(),
  source: EventSourceSchema.nullable(),
  selfImposed: z.number().nullable(),
  status: EventStatusSchema.nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable()
});

// Thread node inline edit (cycle-50 FR-THR-06). Strict partial — only these
// presentation fields are editable here. start/end/status/threadId/source and
// external calendar identity are intentionally NOT editable in this A-slice;
// `.strict()` rejects them (and any score/autoApply injection). At least one
// field is required.
export const PatchThreadEventNodeRequestSchema = z
  .object({
    title: z.string().trim().min(1),
    type: z.string().trim().nullable(),
    location: z.string().trim().nullable(),
    mode: EventModeSchema.nullable()
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length >= 1, { message: "at least one field is required" });

export type EventMode = z.infer<typeof EventModeSchema>;
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;
export type EventRow = z.infer<typeof EventRowSchema>;
export type PatchThreadEventNodeRequest = z.infer<typeof PatchThreadEventNodeRequestSchema>;
