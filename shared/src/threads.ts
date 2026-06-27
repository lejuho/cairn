import { z } from "zod";
import { LinkFirmnessSchema, LinkKindSchema, LinkSourceSchema, ThreadDomainSchema, ThreadLinkKindSchema, ThreadStatusSchema } from "./enums.js";
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
  // Thread domain (cycle-67 FR-DOM-01). Required; always lowercase personal|work.
  domain: ThreadDomainSchema,
  createdAt: z.string().nullable()
});

export const CreateThreadRequestSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.string().optional(),
  goal: z.string().optional(),
  deadline: z.string().optional(),
  // Optional on create; defaults to `personal` server-side when omitted.
  domain: ThreadDomainSchema.optional()
});

// Thread-list / Today domain filter (cycle-67 FR-DOM-01). `all` preserves
// existing behavior; default `all`. Strict — invalid values → 400.
export const DomainFilterSchema = z.enum(["all", "personal", "work"]);
export const ThreadListQuerySchema = z
  .object({ domain: DomainFilterSchema.default("all") })
  .strict();

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

// Decomposed paid-cost shape. Defined here (above the rollup schemas) so both
// FR-THR-10 rollup paid cost and FR-THR-07 settlement reuse the SAME strict
// shape rather than introducing a second cost model. Strict → rejects injected
// scalar score/recommendation fields.
export const ThreadSettlementEffortBucketSchema = z
  .object({
    none: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative()
  })
  .strict();

export const ThreadSettlementPaidCostSchema = z
  .object({
    eventCount: z.number().int().nonnegative(),
    money: z.number().int().nonnegative(),
    social: z.number().int().nonnegative(),
    effort: ThreadSettlementEffortBucketSchema,
    windowCount: z.number().int().nonnegative()
  })
  .strict();

// Thread rollup schemas (FR-THR-10 Rollup A). `paidCost` (cycle-60) reuses the
// decomposed settlement paid-cost shape: observed moved/cancelled event cost
// only; no scalar score, avoided money, or recommendation.

export const ThreadRollupMetricSchema = z.object({
  progress: ThreadProgressSchema,
  energyHours: z.number(),
  paidCost: ThreadSettlementPaidCostSchema
});

export const ThreadRollupBucketSchema = z.object({
  childCount: z.number(),
  descendantCount: z.number(),
  progress: ThreadProgressSchema,
  energyHours: z.number(),
  paidCost: ThreadSettlementPaidCostSchema,
  missingCost: z.null(),
  missingCostStatus: z.literal("unavailable")
});

export const ThreadRollupChildSchema = z.object({
  thread: ThreadLinkPeerSchema,
  depth: z.number().int().positive(),
  relationId: z.number(),
  progress: ThreadProgressSchema,
  energyHours: z.number(),
  paidCost: ThreadSettlementPaidCostSchema,
  descendantCount: z.number()
});

export const ThreadRollupSchema = z.object({
  direct: ThreadRollupMetricSchema,
  contains: ThreadRollupBucketSchema,
  total: z.object({
    progress: ThreadProgressSchema,
    energyHours: z.number(),
    paidCost: ThreadSettlementPaidCostSchema,
    missingCost: z.null(),
    missingCostStatus: z.literal("unavailable")
  }),
  children: z.array(ThreadRollupChildSchema),
  warnings: z.array(z.string())
});

// Thread node link confirm contract (cycle-50 FR-THR-05). A `links` row whose
// both endpoints (event/task) belong to the same thread, surfaced for explicit
// firmness confirmation. firmness/source are display evidence, not editable
// node fields.
export const ThreadNodeKindSchema = z.enum(["event", "task"]);

export const ThreadNodeRefSchema = z
  .object({
    kind: ThreadNodeKindSchema,
    id: z.number().int().positive(),
    title: z.string()
  })
  .strict();

export const ThreadNodeLinkSchema = z
  .object({
    id: z.number().int().positive(),
    kind: LinkKindSchema,
    firmness: LinkFirmnessSchema,
    source: LinkSourceSchema,
    from: ThreadNodeRefSchema,
    to: ThreadNodeRefSchema
  })
  .strict();

export const ConfirmThreadNodeLinkResponseDataSchema = z
  .object({
    link: ThreadNodeLinkSchema,
    reused: z.boolean()
  })
  .strict();

// Unknown Blocking A (cycle-52 FR-THR-04). A read-only diagnostic: an in-thread
// dependency link whose downstream node has a reverse-planning target (event
// start / task due) but whose upstream prerequisite lacks the duration/timing
// input needed to plan backward. Diagnostic only — no planning, no inference.
export const ThreadUnknownBlockerMissingFieldSchema = z.enum([
  "task.estMinutes",
  "event.start",
  "event.end"
]);

export const ThreadUnknownBlockerBlockedFieldSchema = z.enum(["event.start", "task.due"]);

export const ThreadUnknownBlockerReasonCodeSchema = z.enum([
  "blocker_missing_duration",
  "blocker_missing_start",
  "blocker_missing_end",
  "blocker_soft_link"
]);

export const ThreadUnknownBlockerSchema = z
  .object({
    id: z.string().min(1),
    linkId: z.number().int().positive(),
    linkKind: LinkKindSchema,
    firmness: LinkFirmnessSchema,
    source: LinkSourceSchema,
    prerequisite: ThreadNodeRefSchema,
    blockedNode: ThreadNodeRefSchema,
    missingField: ThreadUnknownBlockerMissingFieldSchema,
    blockedField: ThreadUnknownBlockerBlockedFieldSchema,
    message: z.string().min(1),
    reasonCodes: z.array(ThreadUnknownBlockerReasonCodeSchema)
  })
  .strict();

// Settlement A (cycle-53 FR-THR-07). A read-only deterministic summary for a
// completed thread: actual paid cost evidence from its direct moved/cancelled
// events, plus a conservative avoided-missing count from done direct nodes.
// Direct nodes only (contains descendants stay in `rollup`). No money is
// invented; avoided money stays unavailable.
export const ThreadSettlementStatusSchema = z.enum(["not_ready", "ready"]);
export const ThreadSettlementSampleStatusSchema = z.enum(["empty", "partial", "complete"]);

// ThreadSettlementEffortBucketSchema is defined above the rollup schemas so both
// rollup and settlement reuse it (cycle-60).

export const ThreadSettlementReasonCodeSchema = z.enum([
  "settlement_not_done",
  "settlement_ready",
  "settlement_no_nodes",
  "settlement_complete",
  "settlement_partial",
  "settlement_paid_cost_present",
  "settlement_avoided_money_unavailable"
]);

// ThreadSettlementPaidCostSchema is defined above the rollup schemas (cycle-60).

export const ThreadSettlementAvoidedMissingSchema = z
  .object({
    doneCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    knownAvoidedCount: z.number().int().nonnegative(),
    unknownCostCount: z.number().int().nonnegative(),
    money: z.null(),
    moneyStatus: z.literal("unavailable")
  })
  .strict();

export const ThreadSettlementSchema = z
  .object({
    status: ThreadSettlementStatusSchema,
    paidCost: ThreadSettlementPaidCostSchema,
    avoidedMissing: ThreadSettlementAvoidedMissingSchema,
    sampleStatus: ThreadSettlementSampleStatusSchema,
    reasonCodes: z.array(ThreadSettlementReasonCodeSchema)
  })
  .strict();

// Missing Node Suggestions A (cycle-54 FR-THR-08). Read-only evidence cards:
// node titles found among `done` direct nodes of OTHER completed same-kind
// threads that the current thread does not yet have. Suggestions stay
// soft/inferred and never copy historical dates, ordering, or dependency edges.
export const ThreadMissingNodeSuggestionReasonCodeSchema = z.enum([
  "missing_same_kind_completed_thread",
  "missing_absent_from_current_thread",
  "missing_repeated_evidence"
]);

export const ThreadMissingNodeSampleThreadSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string()
  })
  .strict();

export const ThreadMissingNodeSuggestionSchema = z
  .object({
    id: z.string().min(1),
    nodeKind: z.enum(["event", "task"]),
    title: z.string().min(1),
    firmness: z.literal("soft"),
    source: z.literal("inferred"),
    evidenceThreadCount: z.number().int().nonnegative(),
    evidenceNodeCount: z.number().int().nonnegative(),
    sampleThreads: z.array(ThreadMissingNodeSampleThreadSchema),
    reasonCodes: z.array(ThreadMissingNodeSuggestionReasonCodeSchema)
  })
  .strict();

// Resume / CV STAR fields (cycle-56 FR-CV-01/03). Persisted, user-owned,
// editable only on completed threads. Deterministic persistence — no LLM, no
// export. `task` is intentionally NOT a stored field (Task stays display-only).
export const ThreadResumeDataSchema = z
  .object({
    resumeRelevant: z.boolean(),
    starSituation: z.string().nullable(),
    starAction: z.string().nullable(),
    starResult: z.string().nullable(),
    skillsTags: z.array(z.string())
  })
  .strict();

export const PatchThreadResumeRequestSchema = z
  .object({
    resumeRelevant: z.boolean(),
    starSituation: z.string().nullable(),
    starAction: z.string().nullable(),
    starResult: z.string().nullable(),
    skillsTags: z.array(z.string().trim().min(1)).max(8)
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length >= 1, { message: "at least one field is required" });

export const PatchThreadResumeResponseDataSchema = ThreadResumeDataSchema;

// Resume export A (cycle-57 FR-CV-02). Deterministic, read-only export of the
// SAVED resume fields as JSON or Markdown. No LLM, no DB write, no star_task.
export const ThreadResumeExportFormatSchema = z.enum(["json", "markdown"]);

export const ThreadResumeExportJsonSchema = z
  .object({
    thread: z
      .object({
        id: z.number().int().positive(),
        name: z.string(),
        kind: z.string().nullable(),
        goal: z.string().nullable(),
        deadline: z.string().nullable()
      })
      .strict(),
    star: z
      .object({
        situation: z.string().nullable(),
        action: z.string().nullable(),
        result: z.string().nullable()
      })
      .strict(),
    skills: z.array(z.string())
  })
  .strict();

// Discriminated on format so the runtime contract enforces the plan's output
// spec: `json` is present (and required) for the json format and absent for
// markdown. Each branch is `.strict()`, so a markdown payload carrying `json`
// or a json payload missing `json` is rejected.
export const ThreadResumeExportDataSchema = z.discriminatedUnion("format", [
  z
    .object({
      format: z.literal("json"),
      content: z.string(),
      json: ThreadResumeExportJsonSchema,
      warnings: z.array(z.string())
    })
    .strict(),
  z
    .object({
      format: z.literal("markdown"),
      content: z.string(),
      warnings: z.array(z.string())
    })
    .strict()
]);

export const ThreadResumeExportQuerySchema = z
  .object({ format: ThreadResumeExportFormatSchema })
  .strict();

// Person Thread Focus A (cycle-66 FR-PPL-07/FR-XREL-03). Read-only highlight
// layer: the people attached (via event_people) to events in this thread, with
// the in-thread event ids they appear on. Strict — descriptive only, rejects
// injected score/recommendation/action/autoApply fields.
export const ThreadPersonFocusPersonSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    relation: z.string().nullable()
  })
  .strict();

export const ThreadPersonFocusRowSchema = z
  .object({
    person: ThreadPersonFocusPersonSchema,
    eventIds: z.array(z.number().int().positive())
  })
  .strict();

export const ThreadPersonFocusSchema = z
  .object({
    people: z.array(ThreadPersonFocusRowSchema)
  })
  .strict();

export const ThreadDetailSchema = z.object({
  thread: ThreadRowSchema,
  events: z.array(EventRowSchema),
  tasks: z.array(TaskRowSchema),
  progress: ThreadProgressSchema,
  relations: ThreadRelationsSchema,
  rollup: ThreadRollupSchema,
  nodeLinks: z.array(ThreadNodeLinkSchema),
  unknownBlockers: z.array(ThreadUnknownBlockerSchema),
  settlement: ThreadSettlementSchema,
  missingNodeSuggestions: z.array(ThreadMissingNodeSuggestionSchema),
  resume: ThreadResumeDataSchema,
  personFocus: ThreadPersonFocusSchema
});

export type ThreadRow = z.infer<typeof ThreadRowSchema>;
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;
export type DomainFilter = z.infer<typeof DomainFilterSchema>;
export type ThreadListQuery = z.infer<typeof ThreadListQuerySchema>;
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
export type ThreadPersonFocus = z.infer<typeof ThreadPersonFocusSchema>;
export type ThreadPersonFocusRow = z.infer<typeof ThreadPersonFocusRowSchema>;
export type ThreadResumeData = z.infer<typeof ThreadResumeDataSchema>;
export type PatchThreadResumeRequest = z.infer<typeof PatchThreadResumeRequestSchema>;
export type PatchThreadResumeResponseData = z.infer<typeof PatchThreadResumeResponseDataSchema>;
export type ThreadResumeExportFormat = z.infer<typeof ThreadResumeExportFormatSchema>;
export type ThreadResumeExportJson = z.infer<typeof ThreadResumeExportJsonSchema>;
export type ThreadResumeExportData = z.infer<typeof ThreadResumeExportDataSchema>;
export type ThreadNodeKind = z.infer<typeof ThreadNodeKindSchema>;
export type ThreadNodeRef = z.infer<typeof ThreadNodeRefSchema>;
export type ThreadNodeLink = z.infer<typeof ThreadNodeLinkSchema>;
export type ConfirmThreadNodeLinkResponseData = z.infer<typeof ConfirmThreadNodeLinkResponseDataSchema>;
export type ThreadUnknownBlockerMissingField = z.infer<typeof ThreadUnknownBlockerMissingFieldSchema>;
export type ThreadUnknownBlockerBlockedField = z.infer<typeof ThreadUnknownBlockerBlockedFieldSchema>;
export type ThreadUnknownBlockerReasonCode = z.infer<typeof ThreadUnknownBlockerReasonCodeSchema>;
export type ThreadUnknownBlocker = z.infer<typeof ThreadUnknownBlockerSchema>;
export type ThreadSettlementStatus = z.infer<typeof ThreadSettlementStatusSchema>;
export type ThreadSettlementSampleStatus = z.infer<typeof ThreadSettlementSampleStatusSchema>;
export type ThreadSettlementEffortBucket = z.infer<typeof ThreadSettlementEffortBucketSchema>;
export type ThreadSettlementPaidCost = z.infer<typeof ThreadSettlementPaidCostSchema>;
export type ThreadSettlementReasonCode = z.infer<typeof ThreadSettlementReasonCodeSchema>;
export type ThreadSettlement = z.infer<typeof ThreadSettlementSchema>;
export type ThreadMissingNodeSuggestionReasonCode = z.infer<typeof ThreadMissingNodeSuggestionReasonCodeSchema>;
export type ThreadMissingNodeSampleThread = z.infer<typeof ThreadMissingNodeSampleThreadSchema>;
export type ThreadMissingNodeSuggestion = z.infer<typeof ThreadMissingNodeSuggestionSchema>;
export type ThreadRollupMetric = z.infer<typeof ThreadRollupMetricSchema>;
export type ThreadRollupBucket = z.infer<typeof ThreadRollupBucketSchema>;
export type ThreadRollupChild = z.infer<typeof ThreadRollupChildSchema>;
export type ThreadRollup = z.infer<typeof ThreadRollupSchema>;
