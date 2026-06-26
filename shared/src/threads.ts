import { z } from "zod";
import { LinkFirmnessSchema, LinkKindSchema, LinkSourceSchema, ThreadLinkKindSchema, ThreadStatusSchema } from "./enums.js";
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

// Thread rollup schemas (FR-THR-10 Rollup A)

export const ThreadRollupMetricSchema = z.object({
  progress: ThreadProgressSchema,
  energyHours: z.number()
});

export const ThreadRollupBucketSchema = z.object({
  childCount: z.number(),
  descendantCount: z.number(),
  progress: ThreadProgressSchema,
  energyHours: z.number(),
  missingCost: z.null(),
  missingCostStatus: z.literal("unavailable")
});

export const ThreadRollupChildSchema = z.object({
  thread: ThreadLinkPeerSchema,
  depth: z.number().int().positive(),
  relationId: z.number(),
  progress: ThreadProgressSchema,
  energyHours: z.number(),
  descendantCount: z.number()
});

export const ThreadRollupSchema = z.object({
  direct: ThreadRollupMetricSchema,
  contains: ThreadRollupBucketSchema,
  total: z.object({
    progress: ThreadProgressSchema,
    energyHours: z.number(),
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

export const ThreadSettlementEffortBucketSchema = z
  .object({
    none: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative()
  })
  .strict();

export const ThreadSettlementReasonCodeSchema = z.enum([
  "settlement_not_done",
  "settlement_ready",
  "settlement_no_nodes",
  "settlement_complete",
  "settlement_partial",
  "settlement_paid_cost_present",
  "settlement_avoided_money_unavailable"
]);

export const ThreadSettlementPaidCostSchema = z
  .object({
    eventCount: z.number().int().nonnegative(),
    money: z.number().int().nonnegative(),
    social: z.number().int().nonnegative(),
    effort: ThreadSettlementEffortBucketSchema,
    windowCount: z.number().int().nonnegative()
  })
  .strict();

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
  missingNodeSuggestions: z.array(ThreadMissingNodeSuggestionSchema)
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
export type ThreadSettlementReasonCode = z.infer<typeof ThreadSettlementReasonCodeSchema>;
export type ThreadSettlement = z.infer<typeof ThreadSettlementSchema>;
export type ThreadMissingNodeSuggestionReasonCode = z.infer<typeof ThreadMissingNodeSuggestionReasonCodeSchema>;
export type ThreadMissingNodeSampleThread = z.infer<typeof ThreadMissingNodeSampleThreadSchema>;
export type ThreadMissingNodeSuggestion = z.infer<typeof ThreadMissingNodeSuggestionSchema>;
export type ThreadRollupMetric = z.infer<typeof ThreadRollupMetricSchema>;
export type ThreadRollupBucket = z.infer<typeof ThreadRollupBucketSchema>;
export type ThreadRollupChild = z.infer<typeof ThreadRollupChildSchema>;
export type ThreadRollup = z.infer<typeof ThreadRollupSchema>;
