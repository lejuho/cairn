import { z } from "zod";
import { ThreadStatusSchema } from "./enums.js";
import { EventRowSchema } from "./events.js";
import { TaskRowSchema } from "./tasks.js";

export const ThreadRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string().nullable(),
  goal: z.string().nullable(),
  definitionOfDone: z.string().nullable(),
  deadline: z.string().nullable(),
  status: ThreadStatusSchema.nullable(),
  createdAt: z.string().nullable()
});

export const CreateThreadRequestSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.string().optional(),
  goal: z.string().optional(),
  deadline: z.string().optional()
});

export const ThreadProgressSchema = z.object({
  done: z.number(),
  total: z.number()
});

export const ThreadSummarySchema = z.object({
  thread: ThreadRowSchema,
  eventCount: z.number(),
  taskCount: z.number(),
  doneCount: z.number(),
  totalCount: z.number()
});

export const ThreadDetailSchema = z.object({
  thread: ThreadRowSchema,
  events: z.array(EventRowSchema),
  tasks: z.array(TaskRowSchema),
  progress: ThreadProgressSchema
});

export type ThreadRow = z.infer<typeof ThreadRowSchema>;
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;
export type ThreadProgress = z.infer<typeof ThreadProgressSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type ThreadDetail = z.infer<typeof ThreadDetailSchema>;
