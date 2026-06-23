import { z } from "zod";

// --- Query schema ---

export const EgoGraphTargetTypeSchema = z.enum(["resource", "person"]);

export const EgoGraphQuerySchema = z
  .object({
    targetType: EgoGraphTargetTypeSchema,
    targetId: z
      .string()
      .regex(/^\d+$/, "targetId must be a positive integer string")
      .transform(Number)
      .pipe(z.number().int().positive()),
    limit: z
      .string()
      .optional()
      .transform((v) => (v == null ? 10 : Number(v)))
      .pipe(z.number().int().min(5).max(10))
  })
  .strict();

// --- Node and edge schemas ---

export const EgoGraphNodeTypeSchema = z.enum([
  "resource",
  "person",
  "event",
  "task",
  "thread"
]);

export const EgoGraphEdgeKindSchema = z.enum([
  "resource_link",
  "source_person",
  "event_people",
  "thread_link"
]);

export const EgoGraphFirmnessSchema = z.enum(["hard", "soft", "tentative"]);

export const EgoGraphEdgeRelationKindSchema = z.enum([
  "contains",
  "blocks",
  "feeds",
  "competes",
  "shares"
]);

export const EgoGraphNodeSchema = z
  .object({
    id: z.string().min(1),
    type: EgoGraphNodeTypeSchema,
    targetId: z.number().int().positive(),
    label: z.string(),
    sublabel: z.string().optional(),
    href: z.string().optional()
  })
  .strict();

export const EgoGraphEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    kind: EgoGraphEdgeKindSchema,
    firmness: EgoGraphFirmnessSchema,
    reason: z.string().optional(),
    relationKind: EgoGraphEdgeRelationKindSchema.optional()
  })
  .strict();

export const EgoGraphDataSchema = z
  .object({
    center: EgoGraphNodeSchema,
    nodes: z.array(EgoGraphNodeSchema),
    edges: z.array(EgoGraphEdgeSchema),
    truncated: z.boolean()
  })
  .strict();

// --- Types ---

export type EgoGraphTargetType = z.infer<typeof EgoGraphTargetTypeSchema>;
export type EgoGraphNodeType = z.infer<typeof EgoGraphNodeTypeSchema>;
export type EgoGraphEdgeKind = z.infer<typeof EgoGraphEdgeKindSchema>;
export type EgoGraphFirmness = z.infer<typeof EgoGraphFirmnessSchema>;
export type EgoGraphNode = z.infer<typeof EgoGraphNodeSchema>;
export type EgoGraphEdge = z.infer<typeof EgoGraphEdgeSchema>;
export type EgoGraphData = z.infer<typeof EgoGraphDataSchema>;
