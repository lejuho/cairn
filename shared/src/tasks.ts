import { z } from "zod";
import { TaskStatusSchema } from "./enums.js";

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
  createdAt: z.string().nullable()
});

export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type PatchTaskStatusRequest = z.infer<typeof PatchTaskStatusRequestSchema>;
export type TaskRow = z.infer<typeof TaskRowSchema>;
