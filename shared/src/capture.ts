import { z } from "zod";
import { EventRowSchema } from "./events.js";

export const FlatCaptureRequestSchema = z.object({
  text: z.string().trim().min(1, "text must be non-empty"),
  now: z.string().datetime({ offset: true }).optional(),
  timeZone: z.string().min(1).optional()
});

export const FlatEventParseResultSchema = z.object({
  title: z.string().min(1),
  start: z.string().datetime({ offset: true }).optional()
});

export const CaptureStatusSchema = z.enum(["scheduled", "unscheduled", "raw_stored"]);

export const FlatCaptureResponseDataSchema = z.object({
  event: EventRowSchema,
  captureStatus: CaptureStatusSchema,
  llmError: z.string().optional()
});

export type FlatCaptureRequest = z.infer<typeof FlatCaptureRequestSchema>;
export type FlatEventParseResult = z.infer<typeof FlatEventParseResultSchema>;
export type CaptureStatus = z.infer<typeof CaptureStatusSchema>;
export type FlatCaptureResponseData = z.infer<typeof FlatCaptureResponseDataSchema>;
