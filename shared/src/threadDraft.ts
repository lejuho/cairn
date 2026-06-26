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

// A timeZone must be a real IANA zone (e.g. "Asia/Seoul"), not an arbitrary
// string, so it can be passed safely into date formatting / the parser prompt.
function isIanaTimeZone(tz: string): boolean {
  try {
    // Intl throws RangeError on an unknown timezone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const CreateThreadDraftRequestSchema = z
  .object({
    text: z.string().trim().min(1, "text must be non-empty").max(4000, "text too long"),
    now: z.string().datetime({ offset: true }).optional(),
    timeZone: z.string().min(1).refine(isIanaTimeZone, "must be a valid IANA timezone").optional()
  })
  .strict();

const CalendarDateSchema = z.string().refine(isCalendarDate, "must be a real YYYY-MM-DD date");

// Placeholder tokens an LLM might emit for an unknown text field. They must
// never be persisted as durable facts (FR-THR-03), so a draft nullable-text
// field trims and normalizes empty/placeholder values to null — the unknown
// then surfaces as input-needed rather than as fabricated data.
const PLACEHOLDER_TOKENS = new Set([
  "?", "??", "-", "--", "n/a", "na", "tbd", "tba", "unknown", "none", "null",
  "미정", "모름", "없음", "추후", "추후결정"
]);

const DraftNullableText = z
  .string()
  .nullable()
  .optional()
  .transform((v) => {
    if (v == null) return null;
    const trimmed = v.trim();
    if (trimmed === "" || PLACEHOLDER_TOKENS.has(trimmed.toLowerCase())) return null;
    return trimmed;
  });

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
    kind: DraftNullableText,
    goal: DraftNullableText,
    deadline: CalendarDateSchema.nullable().optional()
  })
  .strict();

const ThreadDraftEventSchema = z
  .object({
    tempId: z.string().min(1),
    title: z.string().min(1),
    type: DraftNullableText,
    start: z.string().datetime({ offset: true }).nullable().optional(),
    end: z.string().datetime({ offset: true }).nullable().optional(),
    location: DraftNullableText,
    mode: EventModeSchema.nullable().optional()
  })
  .strict();

const ThreadDraftTaskSchema = z
  .object({
    tempId: z.string().min(1),
    title: z.string().min(1),
    estMinutes: z.number().int().positive().nullable().optional(),
    due: CalendarDateSchema.nullable().optional(),
    context: DraftNullableText,
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
