import { z } from "zod";

export const RESOURCE_KINDS = ["item", "knowledge"] as const;
export const ResourceKindSchema = z.enum(RESOURCE_KINDS);

export const RESOURCE_TARGET_TYPES = ["event", "task", "thread"] as const;
export const ResourceTargetTypeSchema = z.enum(RESOURCE_TARGET_TYPES);

export const RESOURCE_FIRMNESSES = ["hard", "soft", "tentative"] as const;
export const ResourceFirmnessSchema = z.enum(RESOURCE_FIRMNESSES);

export const CreateResourceRequestSchema = z
  .object({
    name: z.string().min(1).max(120).transform((s) => s.trim()),
    kind: ResourceKindSchema,
    sourcePersonId: z.number().int().positive().nullable().optional(),
    note: z.string().max(500).nullable().optional()
  })
  .strict();

export const ResourceRowSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    kind: ResourceKindSchema,
    sourcePersonId: z.number().int().positive().nullable(),
    note: z.string().nullable(),
    createdAt: z.string().nullable()
  })
  .strict();

export const CreateResourceLinkRequestSchema = z
  .object({
    targetType: ResourceTargetTypeSchema,
    targetId: z.number().int().positive(),
    firmness: ResourceFirmnessSchema.default("soft"),
    reason: z.string().max(300).nullable().optional()
  })
  .strict();

export const ResourceLinkRowSchema = z
  .object({
    id: z.number().int().positive(),
    resourceId: z.number().int().positive(),
    targetType: ResourceTargetTypeSchema,
    targetId: z.number().int().positive(),
    firmness: ResourceFirmnessSchema,
    reason: z.string().nullable(),
    createdAt: z.string().nullable()
  })
  .strict();

export const ThreadResourceFocusLinkSchema = z
  .object({
    targetType: ResourceTargetTypeSchema,
    targetId: z.number().int().positive(),
    firmness: ResourceFirmnessSchema,
    reason: z.string().nullable()
  })
  .strict();

export const ThreadResourceFocusItemSchema = z
  .object({
    resource: ResourceRowSchema,
    sourcePerson: z
      .object({ id: z.number(), name: z.string() })
      .nullable(),
    links: z.array(ThreadResourceFocusLinkSchema)
  })
  .strict();

export const ThreadResourceFocusDataSchema = z
  .object({
    threadId: z.number().int().positive(),
    resources: z.array(ThreadResourceFocusItemSchema)
  })
  .strict();

// Promotion suggestion schemas (cycle-39 FR-XREL-01 slice A)

export const PromotionOccurrenceSchema = z
  .object({
    targetType: ResourceTargetTypeSchema,
    targetId: z.number().int().positive()
  })
  .strict();

export const PromotionSuggestionSchema = z
  .object({
    candidateKey: z.string(),
    name: z.string(),
    kind: ResourceKindSchema,
    occurrenceCount: z.number().int().nonnegative(),
    occurrences: z.array(PromotionOccurrenceSchema),
    existingResourceId: z.number().int().positive().optional()
  })
  .strict();

export const PromotionSuggestionsDataSchema = z
  .object({
    suggestions: z.array(PromotionSuggestionSchema)
  })
  .strict();

export const ApprovePromotionRequestSchema = z
  .object({
    candidateKey: z.string().min(1),
    name: z.string().min(1).max(120),
    kind: ResourceKindSchema,
    occurrences: z.array(PromotionOccurrenceSchema).min(2),
    sourcePersonId: z.number().int().positive().nullable().optional(),
    note: z.string().max(500).nullable().optional()
  })
  .strict();

export type ResourceKind = z.infer<typeof ResourceKindSchema>;
export type ResourceTargetType = z.infer<typeof ResourceTargetTypeSchema>;
export type ResourceFirmness = z.infer<typeof ResourceFirmnessSchema>;
export type ResourceRow = z.infer<typeof ResourceRowSchema>;
export type ResourceLinkRow = z.infer<typeof ResourceLinkRowSchema>;
export type CreateResourceRequest = z.infer<typeof CreateResourceRequestSchema>;
export type CreateResourceLinkRequest = z.infer<typeof CreateResourceLinkRequestSchema>;
export type ThreadResourceFocusItem = z.infer<typeof ThreadResourceFocusItemSchema>;
export type ThreadResourceFocusData = z.infer<typeof ThreadResourceFocusDataSchema>;
export type PromotionOccurrence = z.infer<typeof PromotionOccurrenceSchema>;
export type PromotionSuggestion = z.infer<typeof PromotionSuggestionSchema>;
export type PromotionSuggestionsData = z.infer<typeof PromotionSuggestionsDataSchema>;
export type ApprovePromotionRequest = z.infer<typeof ApprovePromotionRequestSchema>;
