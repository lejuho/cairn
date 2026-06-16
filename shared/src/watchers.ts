import { z } from "zod";
import { WatcherKindSchema } from "./enums.js";

export const CreateWatcherRequestSchema = z.object({
  label: z.string().min(1),
  threshold: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  category: z.string().optional()
});

export const PatchWatcherSnoozeRequestSchema = z.object({
  snoozedUntil: z.string().datetime({ offset: true })
});

export const WatcherRowSchema = z.object({
  id: z.number(),
  category: z.string().nullable(),
  label: z.string().nullable(),
  kind: WatcherKindSchema.nullable(),
  armed: z.number().nullable(),
  rule: z.string().nullable(),
  threshold: z.string().nullable(),
  lastFired: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  createdAt: z.string().nullable()
});

export type CreateWatcherRequest = z.infer<typeof CreateWatcherRequestSchema>;
export type PatchWatcherSnoozeRequest = z.infer<typeof PatchWatcherSnoozeRequestSchema>;
export type WatcherRow = z.infer<typeof WatcherRowSchema>;
