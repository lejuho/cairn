import { z } from "zod";

export const ANNOTATION_OUTCOMES = ["done", "cancelled", "moved", "late"] as const;
export const AnnotationOutcomeSchema = z.enum(ANNOTATION_OUTCOMES);

export const AnnotationIntakeRequestSchema = z.object({
  text: z.string().trim().min(1, "text must be non-empty")
});

export const ParsedAnnotationSchema = z.object({
  outcome: AnnotationOutcomeSchema.optional(),
  reasonTags: z.array(z.string()).default([]),
  energyAtTime: z.number().int().min(1).max(5).optional(),
  reasonText: z.string().optional()
});

export const AnnotationRowSchema = z.object({
  id: z.number(),
  eventId: z.number().nullable(),
  outcome: AnnotationOutcomeSchema.nullable(),
  reasonTags: z.string().nullable(),
  reasonText: z.string().nullable(),
  energyAtTime: z.number().nullable(),
  loggedAt: z.string()
});

export const AnnotationIntakeSuccessDataSchema = z.discriminatedUnion("parseStatus", [
  z.object({
    annotation: AnnotationRowSchema,
    parseStatus: z.literal("parsed")
  }),
  z.object({
    annotation: AnnotationRowSchema,
    parseStatus: z.literal("raw_stored"),
    llmError: z.string()
  })
]);

export type AnnotationOutcome = z.infer<typeof AnnotationOutcomeSchema>;
export type AnnotationIntakeRequest = z.infer<typeof AnnotationIntakeRequestSchema>;
export type AnnotationRow = z.infer<typeof AnnotationRowSchema>;
export type ParsedAnnotation = z.infer<typeof ParsedAnnotationSchema>;
export type AnnotationIntakeSuccessData = z.infer<typeof AnnotationIntakeSuccessDataSchema>;
