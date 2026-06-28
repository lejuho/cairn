import { z } from "zod";
import { EventRowSchema } from "./events.js";
import { TaskRowSchema } from "./tasks.js";
import { WatcherABubbleSchema } from "./watchers.js";
import { DayFeasibilitySchema } from "./feasibility.js";
import { DomainFilterSchema } from "./threads.js";
import { GeocodeConfidenceSchema, GeocodeUncertaintySchema } from "./maps.js";

// Today location context (cycle-75). Cache-only, provider-neutral location
// metadata attached to event-bearing Today rows. `missing` (blank location) and
// `uncached` (non-empty location with no geocode_cache row) are Today-only
// states; the rest mirror the cycle-73 geocode cache status. Today never calls
// the provider — these are derived from existing geocode_cache rows.
export const TODAY_LOCATION_STATUSES = ["missing", "uncached", "resolved", "ambiguous", "zero_results", "failed"] as const;
export const TodayLocationStatusSchema = z.enum(TODAY_LOCATION_STATUSES);

export const TodayEventLocationContextSchema = z
  .object({
    eventId: z.number().int().positive(),
    locationText: z.string().nullable(),
    status: TodayLocationStatusSchema,
    provider: z.string().nullable(),
    displayLabel: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    confidence: GeocodeConfidenceSchema.nullable(),
    providerStatus: z.string().nullable(),
    uncertainty: GeocodeUncertaintySchema.nullable(),
    updatedAt: z.string().nullable(),
    lastCheckedAt: z.string().nullable()
  })
  .strict();

export const TodayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true }),
  // Domain filter (cycle-67 FR-DOM-01): all|personal|work, default all.
  domain: DomainFilterSchema.default("all")
});

export const ConflictPairSchema = z.object({
  a: EventRowSchema,
  b: EventRowSchema
});

// Deterministic placement metadata for needs-review cards (FR-FEAS-11 A-slice).
// Explanatory only: gives "why now" context, never hides/defers/auto-acts.
export const NeedsReviewPlacementModeSchema = z.enum([
  "low_context_slot",
  "stale_due",
  "no_context"
]);

export const NeedsReviewPlacementSchema = z
  .object({
    mode: NeedsReviewPlacementModeSchema,
    anchorEventId: z.number().int().positive().nullable(),
    ageHours: z.number().int().nonnegative().nullable(),
    reasonCodes: z.array(z.string())
  })
  .strict();

export const TodaySurfaceSchema = z.object({
  date: z.string(),
  now: z.string(),
  state: z.enum(["quiet", "live"]),
  nextEvent: EventRowSchema.nullable(),
  conflicts: z.array(ConflictPairSchema),
  twoMinuteTasks: z.array(TaskRowSchema),
  watcherBubbles: z.array(WatcherABubbleSchema),
  needsReviewEvents: z.array(EventRowSchema),
  unscheduledEvents: z.array(EventRowSchema),
  // Due-imminent tasks with a real due date + positive estimate (cycle-62
  // FR-SLOT-06C), surfaced as read-only schedule prompts.
  dueTaskSchedulePrompts: z.array(TaskRowSchema),
  dayEvents: z.array(EventRowSchema),
  cards: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("conflict"), pair: ConflictPairSchema }),
      z.object({ kind: z.literal("watcher"), watcher: WatcherABubbleSchema }),
      z.object({ kind: z.literal("next_event"), event: EventRowSchema }),
      z.object({ kind: z.literal("two_minute_task"), task: TaskRowSchema }),
      z.object({ kind: z.literal("needs_review"), event: EventRowSchema, placement: NeedsReviewPlacementSchema }),
      z.object({ kind: z.literal("schedule_prompt"), event: EventRowSchema }),
      z.object({ kind: z.literal("task_schedule_prompt"), task: TaskRowSchema })
    ])
  ),
  feasibility: DayFeasibilitySchema,
  // Cache-only location context per event-bearing row (cycle-75). Additive; does
  // not change card discriminants, order, or priority.
  locationContexts: z.array(TodayEventLocationContextSchema)
});

export type TodayQuery = z.infer<typeof TodayQuerySchema>;
export type ConflictPair = z.infer<typeof ConflictPairSchema>;
export type NeedsReviewPlacementMode = z.infer<typeof NeedsReviewPlacementModeSchema>;
export type NeedsReviewPlacement = z.infer<typeof NeedsReviewPlacementSchema>;
export type TodayLocationStatus = z.infer<typeof TodayLocationStatusSchema>;
export type TodayEventLocationContext = z.infer<typeof TodayEventLocationContextSchema>;
export type TodaySurface = z.infer<typeof TodaySurfaceSchema>;
