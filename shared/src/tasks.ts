import { z } from "zod";
import { TaskStatusSchema } from "./enums.js";
import { isCalendarDate } from "./mirror.js";

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1),
  estMinutes: z.number().int().positive().optional(),
  due: z.string().optional(),
  context: z.string().optional(),
  threadId: z.number().int().positive().optional(),
  optional: z.boolean().optional()
});

export const PatchTaskStatusRequestSchema = z.object({
  status: TaskStatusSchema
});

export const TaskRowSchema = z.object({
  id: z.number(),
  threadId: z.number().nullable(),
  title: z.string(),
  estMinutes: z.number().nullable(),
  due: z.string().nullable(),
  context: z.string().nullable(),
  status: TaskStatusSchema.nullable(),
  optional: z.number().nullable(),
  // Source-owned "hide this due-task schedule prompt for this Today date"
  // marker (cycle-62 FR-SLOT-06C). Optional so existing TaskRow fixtures need
  // not change; nullable for the default/legacy state.
  schedulePromptDismissedOn: z.string().nullable().optional(),
  createdAt: z.string().nullable()
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Dismissible due-task schedule prompt (cycle-62 FR-SLOT-06C). Strict body:
// only the explicit Today query date. Rejects injected score/autoApply/
// snoozedUntil/eventId — this is a one-date hide, not a snooze or task-to-event
// action.
export const DismissTaskSchedulePromptRequestSchema = z
  .object({
    dismissedOn: z
      .string()
      .regex(DATE_RE, "dismissedOn must be YYYY-MM-DD")
      .refine(isCalendarDate, "dismissedOn must be a real calendar date")
  })
  .strict();

export const DismissTaskSchedulePromptDataSchema = z
  .object({
    taskId: z.number().int().positive(),
    dismissedOn: z.string()
  })
  .strict();

// Thread node inline edit (cycle-50 FR-THR-06). Strict partial — status and
// threadId are NOT editable here; `.strict()` rejects them. At least one field
// required. `due` must be a real YYYY-MM-DD calendar date or null.
export const PatchThreadTaskNodeRequestSchema = z
  .object({
    title: z.string().trim().min(1),
    estMinutes: z.number().int().positive().nullable(),
    due: z.string().refine(isCalendarDate, "must be a real calendar date").nullable(),
    context: z.string().trim().nullable(),
    optional: z.boolean()
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length >= 1, { message: "at least one field is required" });

export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type PatchTaskStatusRequest = z.infer<typeof PatchTaskStatusRequestSchema>;
export type TaskRow = z.infer<typeof TaskRowSchema>;
export type PatchThreadTaskNodeRequest = z.infer<typeof PatchThreadTaskNodeRequestSchema>;
export type DismissTaskSchedulePromptRequest = z.infer<typeof DismissTaskSchedulePromptRequestSchema>;
export type DismissTaskSchedulePromptData = z.infer<typeof DismissTaskSchedulePromptDataSchema>;
