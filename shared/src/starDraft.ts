import { z } from "zod";
import { ThreadSettlementSchema } from "./threads.js";

// Thread STAR Draft A (cycle-55 FR-CV-01). A completed thread's evidence (goal,
// direct nodes, annotations, settlement) is turned by the LLM into an ephemeral
// STAR card draft. Nothing is persisted; the user edits/exports in a later cycle.
// The model produces narrative text only — confidence and reasonCodes are forced
// deterministically by the service, so the schemas treat them as fixed.

export const ThreadStarDraftReasonCodeSchema = z.enum([
  "star_from_completed_thread",
  "star_user_must_edit",
  "star_result_uses_settlement"
]);

// The fields the LLM is allowed to author.
export const ThreadStarDraftNarrativeSchema = z
  .object({
    situation: z.string().min(1),
    task: z.string().min(1),
    action: z.string().min(1),
    result: z.string().min(1),
    skills: z.array(z.string().min(1)).max(8)
  })
  .strict();

// The full draft = LLM narrative + service-forced confidence/reasonCodes.
export const ThreadStarDraftSchema = z
  .object({
    situation: z.string().min(1),
    task: z.string().min(1),
    action: z.string().min(1),
    result: z.string().min(1),
    skills: z.array(z.string().min(1)).max(8),
    confidence: z.literal("draft"),
    reasonCodes: z.array(ThreadStarDraftReasonCodeSchema)
  })
  .strict();

export const ThreadStarDraftEvidenceThreadSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    kind: z.string().nullable(),
    goal: z.string().nullable(),
    deadline: z.string().nullable()
  })
  .strict();

export const ThreadStarDraftEvidenceSchema = z
  .object({
    thread: ThreadStarDraftEvidenceThreadSchema,
    nodeTitles: z.array(z.string()),
    annotationCount: z.number().int().nonnegative(),
    settlement: ThreadSettlementSchema,
    warnings: z.array(z.string())
  })
  .strict();

export const ThreadStarDraftResponseDataSchema = z
  .object({
    draft: ThreadStarDraftSchema,
    evidence: ThreadStarDraftEvidenceSchema
  })
  .strict();

export type ThreadStarDraftReasonCode = z.infer<typeof ThreadStarDraftReasonCodeSchema>;
export type ThreadStarDraftNarrative = z.infer<typeof ThreadStarDraftNarrativeSchema>;
export type ThreadStarDraft = z.infer<typeof ThreadStarDraftSchema>;
export type ThreadStarDraftEvidenceThread = z.infer<typeof ThreadStarDraftEvidenceThreadSchema>;
export type ThreadStarDraftEvidence = z.infer<typeof ThreadStarDraftEvidenceSchema>;
export type ThreadStarDraftResponseData = z.infer<typeof ThreadStarDraftResponseDataSchema>;
