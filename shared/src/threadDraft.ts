import { z } from "zod";
import { LinkKindSchema } from "./enums.js";
import { EventModeSchema, EventRowSchema } from "./events.js";
import { isCalendarDate } from "./mirror.js";
import { TaskRowSchema } from "./tasks.js";
import { ThreadNodeLinkSchema, ThreadRowSchema } from "./threads.js";

// Thread Draft A (cycle-51 FR-THR-02/03). A user describes work in natural
// language; the LLM parses it into a draft that the route persists as a thread
// with soft/inferred node links. firmness/source/status are NOT part of the LLM
// contract — the service forces them — so the parsed schemas reject them.

export const CreateThreadDraftRequestSchema = z
  .object({
    text: z.string().trim().min(1, "text must be non-empty").max(4000, "text too long"),
    now: z.string().datetime({ offset: true }).optional(),
    timeZone: z.string().min(1).optional()
  })
  .strict();

const CalendarDateSchema = z.string().refine(isCalendarDate, "must be a real YYYY-MM-DD date");

// A draft node referenced by a mapping-only tempId (never persisted).
export const ThreadDraftNodeRefSchema = z
  .object({
    kind: z.enum(["event", "task"]),
    tempId: z.string().min(1)
  })
  .strict();

export const ThreadDraftLinkSchema = z
  .object({
    from: ThreadDraftNodeRefSchema,
    to: ThreadDraftNodeRefSchema,
    kind: LinkKindSchema
  })
  .strict();

export const ThreadDraftWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

// Unknown values are null/omitted, never placeholder strings or guessed dates.
// Offsetless or malformed datetimes fail validation (whole draft rejected).
const ThreadDraftThreadSchema = z
  .object({
    name: z.string().min(1),
    kind: z.string().nullable().optional(),
    goal: z.string().nullable().optional(),
    deadline: CalendarDateSchema.nullable().optional()
  })
  .strict();

const ThreadDraftEventSchema = z
  .object({
    tempId: z.string().min(1),
    title: z.string().min(1),
    type: z.string().nullable().optional(),
    start: z.string().datetime({ offset: true }).nullable().optional(),
    end: z.string().datetime({ offset: true }).nullable().optional(),
    location: z.string().nullable().optional(),
    mode: EventModeSchema.nullable().optional()
  })
  .strict();

const ThreadDraftTaskSchema = z
  .object({
    tempId: z.string().min(1),
    title: z.string().min(1),
    estMinutes: z.number().int().positive().nullable().optional(),
    due: CalendarDateSchema.nullable().optional(),
    context: z.string().nullable().optional(),
    optional: z.boolean().optional()
  })
  .strict();

export const ThreadDraftParsedSchema = z
  .object({
    thread: ThreadDraftThreadSchema,
    events: z.array(ThreadDraftEventSchema),
    tasks: z.array(ThreadDraftTaskSchema),
    links: z.array(ThreadDraftLinkSchema),
    warnings: z.array(ThreadDraftWarningSchema)
  })
  .strict();

export const CreateThreadDraftResponseDataSchema = z
  .object({
    thread: ThreadRowSchema,
    events: z.array(EventRowSchema),
    tasks: z.array(TaskRowSchema),
    nodeLinks: z.array(ThreadNodeLinkSchema),
    warnings: z.array(ThreadDraftWarningSchema)
  })
  .strict();

export type CreateThreadDraftRequest = z.infer<typeof CreateThreadDraftRequestSchema>;
export type ThreadDraftNodeRef = z.infer<typeof ThreadDraftNodeRefSchema>;
export type ThreadDraftLink = z.infer<typeof ThreadDraftLinkSchema>;
export type ThreadDraftWarning = z.infer<typeof ThreadDraftWarningSchema>;
export type ThreadDraftParsed = z.infer<typeof ThreadDraftParsedSchema>;
export type CreateThreadDraftResponseData = z.infer<typeof CreateThreadDraftResponseDataSchema>;
