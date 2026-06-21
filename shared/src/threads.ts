import { z } from "zod";
import { ThreadLinkKindSchema, ThreadStatusSchema } from "./enums.js";
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

// Thread link schemas

export const ThreadLinkFirmnessSchema = z.enum(["hard", "soft"]);

export const ThreadLinkRowSchema = z.object({
  id: z.number(),
  fromThread: z.number().nullable(),
  toThread: z.number().nullable(),
  kind: ThreadLinkKindSchema.nullable(),
  firmness: ThreadLinkFirmnessSchema,
  createdAt: z.string().nullable()
});

export const ThreadLinkPeerSchema = z.object({
  id: z.number(),
  name: z.string()
});

export const ThreadLinkViewSchema = z.object({
  id: z.number(),
  fromThread: ThreadLinkPeerSchema,
  toThread: ThreadLinkPeerSchema,
  kind: ThreadLinkKindSchema,
  firmness: ThreadLinkFirmnessSchema,
  createdAt: z.string().nullable()
});

export const ThreadRelationsSchema = z.object({
  incoming: z.array(ThreadLinkViewSchema),
  outgoing: z.array(ThreadLinkViewSchema)
});

export const CreateThreadLinkRequestSchema = z.object({
  toThreadId: z.number().int().positive(),
  kind: ThreadLinkKindSchema,
  firmness: ThreadLinkFirmnessSchema.optional().default("hard")
});

export const ThreadRelationCountsSchema = z.object({
  incoming: z.number(),
  outgoing: z.number()
});

export const ThreadSummarySchema = z.object({
  thread: ThreadRowSchema,
  eventCount: z.number(),
  taskCount: z.number(),
  doneCount: z.number(),
  totalCount: z.number(),
  relationCounts: ThreadRelationCountsSchema
});

export const ThreadDetailSchema = z.object({
  thread: ThreadRowSchema,
  events: z.array(EventRowSchema),
  tasks: z.array(TaskRowSchema),
  progress: ThreadProgressSchema,
  relations: ThreadRelationsSchema
});

export type ThreadRow = z.infer<typeof ThreadRowSchema>;
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;
export type ThreadProgress = z.infer<typeof ThreadProgressSchema>;
export type ThreadLinkFirmness = z.infer<typeof ThreadLinkFirmnessSchema>;
export type ThreadLinkRow = z.infer<typeof ThreadLinkRowSchema>;
export type ThreadLinkPeer = z.infer<typeof ThreadLinkPeerSchema>;
export type ThreadLinkView = z.infer<typeof ThreadLinkViewSchema>;
export type ThreadRelations = z.infer<typeof ThreadRelationsSchema>;
export type CreateThreadLinkRequest = z.infer<typeof CreateThreadLinkRequestSchema>;
export type ThreadRelationCounts = z.infer<typeof ThreadRelationCountsSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type ThreadDetail = z.infer<typeof ThreadDetailSchema>;
